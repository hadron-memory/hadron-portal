/**
 * #942 — the organization's Channels page: its loader and the org-owned
 * register writes.
 *
 * The fake server answers each query the way hadron-server does: pages capped
 * at 200, and refusals as real `ClientError`s carrying the codes
 * lib/register.ts emits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import { ClientError } from 'graphql-request';
import {
  APP_INSTALLED_AGENTS_QUERY,
  CREATE_REGISTER_ENTRY_MUTATION,
  DELETE_REGISTER_ENTRY_MUTATION,
  ORG_APPS_FOR_REGISTER_QUERY,
  ORG_CHANNELS_QUERY,
  ORG_MEMBER_ROLES_QUERY,
  REGISTER_ENTRIES_BY_OWNER_QUERY,
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

const ORG = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const MEM = { id: 'mem-org', urn: 'hrn:mem:acme.com:shared', name: 'Acme shared' };
function channel(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-1', name: 'All hands', description: null, kind: 'CHAT', loc: 'chats:all-hands',
    chatRootUrn: 'hrn:node:acme.com:shared:chats:all-hands', chatRootNodeId: 'root-1',
    lastSeq: 3, lastMessageAt: null, createdAt: '', memoryId: 'mem-org', memory: MEM, ...over,
  };
}
function row(over: Record<string, unknown> = {}) {
  return {
    id: 're-1', ownerType: 'ORGANIZATION', ownerId: 'org-1', appId: null, organizationId: 'org-1', channelId: 'ch-1',
    channel: { id: 'ch-1', name: 'All hands', loc: 'chats:all-hands', chatRootUrn: null }, attendeeWorkerId: null, attendeeAgentId: null,
    attendeeUrn: null, role: 'BOTH', mentionOnly: false, installDefault: false, description: null, createdAt: '', ...over,
  };
}

function route(opts: {
  channels?: unknown[];
  rows?: unknown[];
  apps?: Array<{ id: string; name: string; urn?: string }>;
  workers?: Record<string, unknown[]>;
  /** `null` is an installed Agent the caller may not read (hadron-server#1526). */
  agents?: Record<string, Array<{ id: string; name: string; urn: string } | null>>;
  /** portal#1148: Apps whose install roster the server withholds (appAgents: null). */
  withheldAgents?: string[];
  members?: Array<{ role: string; user: { id: string } }> | Error;
  registerFails?: boolean;
  /** The org's App list itself fails. */
  appsFail?: boolean;
  /** App ids whose roster read fails. */
  rosterFails?: string[];
  /** Resolves each Worker page read after a tick, and records how many were in flight. */
  track?: { inFlight: number; peak: number };
  /** Same, for the installed-Agent read, which is also slowed. */
  trackAgents?: { inFlight: number; peak: number };
  create?: unknown;
  update?: unknown;
  del?: unknown;
} = {}) {
  const page = (all: unknown[], vars: Record<string, unknown>) => {
    const offset = (vars.offset as number | undefined) ?? 0;
    const limit = Math.min((vars.limit as number | undefined) ?? 50, 200);
    return { total: all.length, items: all.slice(offset, offset + limit) };
  };
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    if (doc === ORG_CHANNELS_QUERY) return { channels: page(opts.channels ?? [channel()], vars) };
    if (doc === REGISTER_ENTRIES_BY_OWNER_QUERY) {
      if (opts.registerFails) throw new Error('boom');
      return { registerEntries: page(opts.rows ?? [], vars) };
    }
    if (doc === ORG_APPS_FOR_REGISTER_QUERY && opts.appsFail) throw new Error('apps boom');
    if (doc === ORG_APPS_FOR_REGISTER_QUERY) return { apps: page((opts.apps ?? []).map((a) => ({ urn: `hrn:app:acme.com:${a.id}`, ...a })), vars) };
    if (doc === WORKERS_QUERY) {
      if (opts.rosterFails?.includes(vars.appRef as string)) throw new Error('roster boom');
      if (opts.track) {
        opts.track.inFlight++;
        opts.track.peak = Math.max(opts.track.peak, opts.track.inFlight);
        await new Promise((r) => setTimeout(r, 2));
        opts.track.inFlight--;
      }
      return { workers: page(opts.workers?.[vars.appRef as string] ?? [], vars) };
    }
    if (doc === APP_INSTALLED_AGENTS_QUERY) {
      if (opts.trackAgents) {
        opts.trackAgents.inFlight++;
        opts.trackAgents.peak = Math.max(opts.trackAgents.peak, opts.trackAgents.inFlight);
        await new Promise((r) => setTimeout(r, 5));
        opts.trackAgents.inFlight--;
      }
      if (opts.withheldAgents?.includes(vars.ref as string)) return { app: { id: vars.ref, appAgents: null } };
      return { app: { id: vars.ref, appAgents: (opts.agents?.[vars.ref as string] ?? []).map((agent) => ({ agent })) } };
    }
    if (doc === ORG_MEMBER_ROLES_QUERY) {
      if (opts.members instanceof Error) throw opts.members;
      return { organization: { id: 'org-1', members: opts.members ?? [{ role: 'CONTRIBUTOR', user: { id: 'u-1' } }] } };
    }
    const reply = doc === CREATE_REGISTER_ENTRY_MUTATION ? opts.create : doc === UPDATE_REGISTER_ENTRY_MUTATION ? opts.update : doc === DELETE_REGISTER_ENTRY_MUTATION ? opts.del : undefined;
    if (reply instanceof Error) throw reply;
    return reply ?? {};
  });
}

type Loaded = {
  channels: Array<{ id: string }>;
  orgRows: Array<{ id: string }>;
  attendees: Array<{ id: string; name: string; kind: string; retired?: boolean }>;
  registerLoadFailed: boolean;
  canManageRegister: boolean | null;
};
async function load(user: { id: string } | null = { id: 'u-1' }, parentExtra: Record<string, unknown> = {}) {
  const { load } = await import('./+page.server');
  return (await load({ params: { id: 'org-1' }, locals: { token: 'tok', user }, parent: async () => ({ org: ORG, ...parentExtra }) } as never)) as unknown as Loaded;
}
async function act(name: 'addAttendance' | 'editAttendance' | 'removeAttendance', fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (actions as Record<string, (e: never) => Promise<unknown>>)[name]({
    request: { formData: async () => fd },
    params: { id: 'org-1' },
    locals: { token: 'tok', user: { id: 'u-1' } },
  } as never) as Promise<{ status?: number; data?: { form?: { message?: unknown } }; form?: { message?: unknown } }>;
}
const msg = (r: Awaited<ReturnType<typeof act>>) => (r.data?.form ?? r.form)?.message;
const sent = (doc: string) => mockRequest.mock.calls.filter(([d]) => d === doc).map(([, v]) => v);

describe('load: form ids (#1320)', () => {
  it('gives the register forms the page mounts their own Superforms ids', async () => {
    route({});
    expectDistinctFormIds(await load(), 3);
  });
});

describe('load', () => {
  it('lists the org’s Channels by orgId (not an App), paged past 200', async () => {
    route({ channels: Array.from({ length: 201 }, (_, i) => channel({ id: `ch-${i}` })) });
    const data = await load();
    expect(data.channels).toHaveLength(201);
    expect(sent(ORG_CHANNELS_QUERY).map((v) => v.orgId)).toEqual(['org-1', 'org-1']);
  });

  it('reads the org’s OWN register rows, by the org as owner', async () => {
    route({ rows: [row(), row({ id: 're-app', ownerType: 'APP', appId: 'app-9', organizationId: null })] });
    const data = await load();
    expect(sent(REGISTER_ENTRIES_BY_OWNER_QUERY)[0]).toMatchObject({ ownerRef: 'org-1' });
    // Defensive: only org-owned rows belong on this page.
    expect(data.orgRows.map((r) => r.id)).toEqual(['re-1']);
  });

  it('offers Workers from every org App (named with their App) and each installed Agent once', async () => {
    route({
      apps: [{ id: 'app-a', name: 'Team A' }, { id: 'app-b', name: 'Team B' }],
      workers: {
        'app-a': [{ id: 'w-1', name: 'Ada', urn: 'hrn:worker:acme.com:a:ada', role: null, retiredAt: null }],
        'app-b': [
          { id: 'w-2', name: 'Ada', urn: 'hrn:worker:acme.com:b:ada', role: null, retiredAt: null },
          { id: 'w-3', name: 'Olaf', urn: null, role: null, retiredAt: '2026-09-01T00:00:00Z' },
        ],
      },
      agents: {
        'app-a': [{ id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' }],
        'app-b': [{ id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' }],
      },
    });
    const data = await load();
    expect(data.attendees).toEqual([
      expect.objectContaining({ id: 'w-1', name: 'Ada (Team A)', kind: 'worker', retired: false }),
      expect.objectContaining({ id: 'w-2', name: 'Ada (Team B)', kind: 'worker', retired: false }),
      expect.objectContaining({ id: 'w-3', name: 'Olaf (Team B)', kind: 'worker', retired: true }),
      expect.objectContaining({ id: 'ag-1', kind: 'agent' }),
    ]);
    expect(sent(WORKERS_QUERY).every((v) => v.includeRetired === true)).toBe(true);
  });

  it('an installed Agent the caller may not read (null, hadron-server#1526) is left out, and the page still loads', async () => {
    route({
      apps: [{ id: 'app-a', name: 'Team A' }],
      workers: { 'app-a': [] },
      agents: { 'app-a': [null, { id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' }] },
    });
    const data = await load();
    expect(data.attendees).toEqual([expect.objectContaining({ id: 'ag-1', kind: 'agent' })]);
  });

  it('two Apps sharing a name stay distinguishable: the App URN joins the label, and rides on the attendee', async () => {
    route({
      apps: [{ id: 'app-a', name: 'Team', urn: 'hrn:app:acme.com:team' }, { id: 'app-b', name: 'Team', urn: 'hrn:app:acme.com:team-2' }],
      workers: {
        'app-a': [{ id: 'w-1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', role: null, retiredAt: null }],
        'app-b': [{ id: 'w-2', name: 'Ada', urn: 'hrn:worker:acme.com:team-2:ada', role: null, retiredAt: null }],
      },
    });
    const data = (await load()) as Loaded & { attendees: Array<{ id: string; name: string; appUrn?: string }> };
    const [a, b] = data.attendees;
    expect(a.name).not.toBe(b.name);
    expect(a).toMatchObject({ name: 'Ada (Team · hrn:app:acme.com:team)', appUrn: 'hrn:app:acme.com:team' });
    expect(b).toMatchObject({ name: 'Ada (Team · hrn:app:acme.com:team-2)', appUrn: 'hrn:app:acme.com:team-2' });
  });

  it('reads App rosters with bounded concurrency, not one burst per App', async () => {
    const track = { inFlight: 0, peak: 0 };
    const apps = Array.from({ length: 12 }, (_, i) => ({ id: `app-${i}`, name: `App ${i}` }));
    route({ apps, track });
    await load();
    expect(sent(WORKERS_QUERY)).toHaveLength(12);
    expect(track.peak).toBeLessThanOrEqual(4);
    expect(track.peak).toBeGreaterThan(1); // still concurrent, just bounded
  });

  it('a fast-failing Worker read does not free the App’s slot while its Agent read still runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const trackAgents = { inFlight: 0, peak: 0 };
    const apps = Array.from({ length: 12 }, (_, i) => ({ id: `app-${i}`, name: `App ${i}` }));
    route({ apps, rosterFails: apps.map((a) => a.id), trackAgents });
    const data = (await load()) as Loaded & { rosterUnreadApps: number };
    expect(trackAgents.peak).toBeLessThanOrEqual(4);
    expect(data.rosterUnreadApps).toBe(12);
    warn.mockRestore();
  });

  it('an App whose install roster is WITHHELD (null) is counted as withheld, not as an App with no agents (portal#1148)', async () => {
    route({
      apps: [{ id: 'app-a', name: 'Team A' }, { id: 'app-b', name: 'Team B' }],
      agents: { 'app-a': [{ id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' }] },
      withheldAgents: ['app-b'],
    });
    const data = (await load()) as Loaded & { rosterUnreadApps: number; rosterWithheldApps: number };
    expect(data.rosterWithheldApps).toBe(1);
    expect(data.rosterUnreadApps).toBe(0);
    expect(data.attendees.filter((a) => a.kind === 'agent').map((a) => a.id)).toEqual(['ag-1']);
  });

  it('known-empty control: a real [] install roster is not withheld', async () => {
    route({ apps: [{ id: 'app-a', name: 'Team A' }] });
    const data = (await load()) as Loaded & { rosterWithheldApps: number };
    expect(data.rosterWithheldApps).toBe(0);
  });

  it('an App whose roster can’t be read is counted, not fatal: the rows still show', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({
      rows: [row()],
      apps: [{ id: 'app-a', name: 'Team A' }, { id: 'app-b', name: 'Team B' }],
      workers: { 'app-a': [{ id: 'w-1', name: 'Ada', urn: null, role: null, retiredAt: null }] },
      rosterFails: ['app-b'],
    });
    const data = (await load()) as Loaded & { rosterUnreadApps: number };
    expect(data.registerLoadFailed).toBe(false);
    expect(data.orgRows.map((r) => r.id)).toEqual(['re-1']);
    expect(data.attendees.map((a) => a.id)).toEqual(['w-1']);
    expect(data.rosterUnreadApps).toBe(1);
    warn.mockRestore();
  });

  it.each([
    ['CONTRIBUTOR', true],
    ['ADMIN', true],
    ['OWNER', true],
    ['READER', false],
  ])('an org %s may manage: %s', async (role, expected) => {
    route({ members: [{ role, user: { id: 'u-1' } }] });
    expect((await load()).canManageRegister).toBe(expected);
  });

  it('a non-member who can open the org, or a failed role read, is UNKNOWN (null): offer, and the server decides', async () => {
    route({ members: [{ role: 'OWNER', user: { id: 'someone-else' } }] });
    expect((await load()).canManageRegister).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ members: new Error('boom') });
    expect((await load()).canManageRegister).toBeNull();
    warn.mockRestore();
  });

  it('a failed register read is REPORTED, not shown as an empty register', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ registerFails: true });
    const data = await load();
    expect(data.registerLoadFailed).toBe(true);
    expect(data.orgRows).toEqual([]);
    warn.mockRestore();
  });

  it('a consumer-mode caller is bounced like the sibling admin tabs, before any API read', async () => {
    route({});
    await expect(load({ id: 'u-1' }, { isConsumerMode: true, activeOrgId: null })).rejects.toMatchObject({ status: expect.any(Number), location: expect.any(String) });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('when even the org’s App list can’t be read, the rows still show and the gap is flagged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ rows: [row()], appsFail: true });
    const data = (await load()) as Loaded & { rosterFailed: boolean };
    expect(data.registerLoadFailed).toBe(false);
    expect(data.orgRows.map((r) => r.id)).toEqual(['re-1']);
    expect(data.rosterFailed).toBe(true);
    expect(data.attendees).toEqual([]);
    warn.mockRestore();
  });

  it('only reads: nothing marks a Channel read or posts', async () => {
    route({ apps: [{ id: 'app-a', name: 'Team A' }] });
    await load();
    for (const [doc] of mockRequest.mock.calls) expect(doc as string).not.toMatch(/mutation|advanceChannelReadState|markOwnTeamChatRead|teamChatPost/i);
  });
});

describe('org-owned register writes', () => {
  it('add creates the row for THIS organization, whatever the form says', async () => {
    route({ create: { createRegisterEntry: { id: 're-new' } } });
    const r = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-1', attendee: 'w-1', role: 'WATCH', description: '', ownerRef: 'app-evil' });
    expect(msg(r)).toEqual({ type: 'success', text: 'Attendance added.' });
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)).toEqual([
      { input: { ownerRef: 'org-1', channelRef: 'ch-1', attendeeRef: 'w-1', role: 'WATCH', mentionOnly: false, description: null } },
    ]);
  });

  it('an empty attendee is everyone in the organization', async () => {
    route({ create: { createRegisterEntry: { id: 're-new' } } });
    await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-1', attendee: '', role: 'BOTH', description: '' });
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)[0]).toMatchObject({ input: { ownerRef: 'org-1', attendeeRef: null } });
  });

  it('an uncoded READER write fault uses generic copy and changes nothing', async () => {
    route({ create: refusal('Forbidden', 'INTERNAL_SERVER_ERROR') });
    const r = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-1', attendee: '', role: 'BOTH', description: '' });
    expect(r.status).toBe(400);
    expect(msg(r)).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
  });

  it('a revoked or foreign Channel/attendee is "not available", never "does not exist"', async () => {
    route({ create: refusal('No match for channelRef "ch-gone".', 'NOT_FOUND'), del: refusal('No match.', 'NOT_FOUND') });
    const add = await act('addAttendance', { _kind: 'addAttendance', channelId: 'ch-gone', attendee: '', role: 'BOTH', description: '' });
    expect((msg(add) as { text: string }).text).toContain('That channel or attendee is not available to you');
    const del = await act('removeAttendance', { _kind: 'removeAttendance', ref: 're-1' });
    expect((msg(del) as { text: string }).text).toContain('That row is not available to you');
  });

  it('invalid input never reaches the server', async () => {
    route({});
    expect((await act('addAttendance', { _kind: 'addAttendance', channelId: '', attendee: '', role: 'BOTH', description: '' })).status).toBe(400);
    expect((await act('removeAttendance', { _kind: 'removeAttendance', ref: '' })).status).toBe(400);
    expect(sent(CREATE_REGISTER_ENTRY_MUTATION)).toHaveLength(0);
    expect(sent(DELETE_REGISTER_ENTRY_MUTATION)).toHaveLength(0);
  });

  it('edit and remove address the row by its ref', async () => {
    route({ update: { updateRegisterEntry: { id: 're-1' } }, del: { deleteRegisterEntry: true } });
    await act('editAttendance', { _kind: 'editAttendance', ref: 're-1', role: 'POST', description: 'on call' });
    await act('removeAttendance', { _kind: 'removeAttendance', ref: 're-1' });
    expect(sent(UPDATE_REGISTER_ENTRY_MUTATION)).toEqual([{ ref: 're-1', input: { role: 'POST', mentionOnly: false, description: 'on call' } }]);
    expect(sent(DELETE_REGISTER_ENTRY_MUTATION)).toEqual([{ ref: 're-1' }]);
  });
});
