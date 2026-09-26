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
  APP_CHANNELS_QUERY,
  APP_SHARED_MEMORY_QUERY,
  CREATE_CHANNEL_MUTATION,
  DELETE_CHANNEL_MUTATION,
  SELF_CAN_WRITE_QUERY,
  UPDATE_CHANNEL_MUTATION,
  APP_INSTALLED_AGENTS_QUERY,
  CREATE_REGISTER_ENTRY_MUTATION,
  DELETE_REGISTER_ENTRY_MUTATION,
  REGISTER_ENTRIES_BY_OWNER_QUERY,
  SELF_CAN_MANAGE_QUERY,
  UPDATE_REGISTER_ENTRY_MUTATION,
  WORKERS_QUERY,
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
  appRows?: unknown[];
  orgRows?: unknown[];
  canManage?: boolean | Error;
  registerFails?: boolean;
  reg?: { create?: unknown; update?: unknown; del?: unknown };
}) {
  const app = opts.app === undefined
    ? { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: { id: 'ch-team' }, sharedMemory: SHARED }
    : opts.app;
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    if (doc === APP_CHANNELS_QUERY) return { app, channels: { total: (opts.channels ?? []).length, items: opts.channels ?? [] } };
    if (doc === APP_SHARED_MEMORY_QUERY) return { app: app && { id: app.id, sharedMemory: app.sharedMemory } };
    if (doc === SELF_CAN_WRITE_QUERY) {
      const v = opts.canWrite?.[vars.resource as string] ?? true;
      if (v instanceof Error) throw v;
      return { effectiveAccess: { canWrite: v } };
    }
    if (doc === REGISTER_ENTRIES_BY_OWNER_QUERY) {
      if (opts.registerFails) throw new Error('boom');
      const items = vars.ownerRef === 'app-1' ? (opts.appRows ?? []) : (opts.orgRows ?? []);
      return { registerEntries: { total: items.length, items } };
    }
    if (doc === WORKERS_QUERY) return { workers: { total: 1, items: [{ id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: 'coordinator' }] } };
    if (doc === APP_INSTALLED_AGENTS_QUERY) return { app: { id: 'app-1', appAgents: [{ agent: { id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' } }] } };
    if (doc === SELF_CAN_MANAGE_QUERY) {
      if (opts.canManage instanceof Error) throw opts.canManage;
      return { effectiveAccess: { canManage: opts.canManage ?? true } };
    }
    const regReply = doc === CREATE_REGISTER_ENTRY_MUTATION ? opts.reg?.create : doc === UPDATE_REGISTER_ENTRY_MUTATION ? opts.reg?.update : doc === DELETE_REGISTER_ENTRY_MUTATION ? opts.reg?.del : undefined;
    if (regReply instanceof Error) throw regReply;
    if (regReply !== undefined) return regReply;
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
    appRows: Array<{ id: string }>;
    orgRows: Array<{ id: string }>;
    attendees: Array<{ id: string; kind: string }>;
    canManageRegister: boolean | null;
    registerLoadFailed: boolean;
  };
}

async function act(name: 'createChannel' | 'renameChannel' | 'deleteChannel' | 'addAttendance' | 'editAttendance' | 'removeAttendance', fields: Record<string, string>) {
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
    route({ channels: [channel(), channel({ id: 'ch-x', loc: 'chats:x', memory: OTHER })], canWrite: { 'mem-other': false } });
    const data = await load();
    expect(data.channels.map((c) => c.id)).toEqual(['ch-team', 'ch-x']);
    expect(data.defaultChannelId).toBe('ch-team');
    expect(data.canWrite).toEqual({ 'mem-shared': true, 'mem-other': false });
    // A SELF-audit: the caller's own user id, one per distinct host.
    expect(sent(SELF_CAN_WRITE_QUERY)).toHaveLength(2);
    expect(sent(SELF_CAN_WRITE_QUERY)[0]).toMatchObject({ user: 'u-1' });
  });

  it('a failed audit is UNKNOWN (null), not "no": the server decides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ channels: [channel()], canWrite: { 'mem-shared': new Error('boom') } });
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

  it('an App with no shared memory gets an explanation and no create', async () => {
    route({ app: { id: 'app-1', name: 'T', urn: 'u', defaultChannel: null, sharedMemory: null } });
    const r = await act('createChannel', { _kind: 'createChannel', name: 'N', slug: 'ok', description: '' });
    expect(r.status).toBe(400);
    expect(sent(CREATE_CHANNEL_MUTATION)).toHaveLength(0);
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

function row(over: Record<string, unknown> = {}) {
  return {
    id: 're-1', ownerType: 'APP', ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-team',
    channel: { id: 'ch-team', name: 'Team chat', loc: 'chats:team' }, attendeeWorkerId: null, attendeeAgentId: null,
    attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: true, description: null, createdAt: '', ...over,
  };
}

describe('load: who takes part (#942 slice 3)', () => {
  it('reads the App’s rows and the organization’s separately, plus Workers and installed Agents as attendees', async () => {
    route({ appRows: [row()], orgRows: [row({ id: 're-org', ownerType: 'ORGANIZATION', appId: null, organizationId: 'org-1' })] });
    const data = await load();
    expect(data.appRows.map((r) => r.id)).toEqual(['re-1']);
    expect(data.orgRows.map((r) => r.id)).toEqual(['re-org']);
    expect(data.attendees).toEqual([
      expect.objectContaining({ id: 'w-ada', kind: 'worker' }),
      expect.objectContaining({ id: 'ag-1', kind: 'agent' }),
    ]);
    expect(sent(REGISTER_ENTRIES_BY_OWNER_QUERY)).toEqual([{ ownerRef: 'app-1' }, { ownerRef: 'org-1' }]);
  });

  it('may-manage is a SELF canManage audit on the App, not App.role', async () => {
    route({ canManage: false });
    const data = await load();
    expect(data.canManageRegister).toBe(false);
    expect(sent(SELF_CAN_MANAGE_QUERY)).toEqual([{ user: 'u-1', resource: 'app-1' }]);
  });

  it('a failed manage audit is unknown (null), offered, and the server decides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ canManage: new Error('boom') });
    expect((await load()).canManageRegister).toBeNull();
    warn.mockRestore();
  });

  it('a failed register read is REPORTED, not shown as an empty register', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ registerFails: true });
    const data = await load();
    expect(data.registerLoadFailed).toBe(true);
    warn.mockRestore();
  });
});

describe('attendance actions', () => {
  it('add: owner is THIS App, and the attendee, mode, mention-only and note are sent as chosen', async () => {
    route({ reg: { create: { createRegisterEntry: { id: 're-new' } } } });
    const r = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-x', attendee: 'w-ada', role: 'WATCH', mentionOnly: 'on', description: 'triage' });
    expect(msg(r)).toEqual({ type: 'success', text: 'Attendance added.' });
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)).toEqual([
      { input: { ownerRef: 'app-1', channelRef: 'ch-x', attendeeRef: 'w-ada', role: 'WATCH', mentionOnly: true, description: 'triage' } },
    ]);
  });

  it('add: an empty attendee means everyone in the App (attendeeRef null)', async () => {
    route({ reg: { create: { createRegisterEntry: { id: 're-new' } } } });
    await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-x', attendee: '', role: 'BOTH', description: '' });
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)[0]).toMatchObject({ input: { attendeeRef: null, mentionOnly: false, description: null } });
  });

  it('add: a missing channel is refused before any request, and an unknown mode is refused too', async () => {
    route({});
    for (const fields of [{ channelId: '', role: 'BOTH' }, { channelId: 'ch-x', role: 'ADMIN' }]) {
      const r = await act('addAttendance', { _kind: 'addAttendance', attendee: '', description: '', ...fields });
      expect(r.status).toBe(400);
    }
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)).toHaveLength(0);
  });

  it('add: a duplicate is explained; an out-of-context attendee is the server’s own words', async () => {
    route({ reg: { create: refusal('A live register entry already exists for this owner, Channel and attendee.', 'REGISTER_ENTRY_EXISTS') } });
    let r = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-x', attendee: 'w-ada', role: 'BOTH', description: '' });
    expect((msg(r) as { text: string }).text).toContain('already takes part');
    route({ reg: { create: refusal('No match for attendeeRef "w-zz" in this owner\'s context.', 'BAD_USER_INPUT') } });
    r = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-x', attendee: 'w-zz', role: 'BOTH', description: '' });
    expect(msg(r)).toEqual({ type: 'error', text: 'No match for attendeeRef "w-zz" in this owner\'s context.' });
  });

  it('edit sends role, mention-only and note for the row', async () => {
    route({ reg: { update: { updateRegisterEntry: { id: 're-1' } } } });
    await act('editAttendance', { _kind: 'editAttendance', ref: 're-1', role: 'POST', description: '' });
    expect(sent(UPDATE_REGISTER_ENTRY_MUTATION)).toEqual([{ ref: 're-1', input: { role: 'POST', mentionOnly: false, description: '' } }]);
  });

  it('remove sends the row; a refusal on a row the caller can’t manage is the server’s words, and nothing else is written', async () => {
    route({ reg: { del: refusal('Forbidden', 'INTERNAL_SERVER_ERROR') } });
    const r = await act('removeAttendance', { _kind: 'removeAttendance', ref: 're-org' });
    expect(msg(r)).toEqual({ type: 'error', text: 'Forbidden' });
    expect(sent(DELETE_REGISTER_ENTRY_MUTATION)).toEqual([{ ref: 're-org' }]);
    expect(mockRequest.mock.calls.filter(([d]) => /mutation/.test(d as string))).toHaveLength(1);
  });
});
