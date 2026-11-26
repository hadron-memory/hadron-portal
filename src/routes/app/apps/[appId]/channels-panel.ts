/**
 * #942 — an App's Channels, as a section of Settings: the list, the register and the three forms' starting state.
 * Read only when the section is asked for (the URL names it, or the reader unfolds it).
 *
 * A read that fails is a state of the section (`failed`), never the App page's 404: the App read gates every tab.
 * (The old /channels page answered an App the caller could not see as a missing one.)
 */
import { ClientError } from 'graphql-request';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { GraphQLClient } from 'graphql-request';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { fetchAllItems } from '$lib/server/paginate';
import { registerForms } from '$lib/server/register-actions';
import {
  APP_CHANNELS_APP_QUERY,
  APP_CHANNELS_QUERY,
  SELF_CAN_WRITE_QUERY,
  APP_INSTALLED_AGENTS_QUERY,
  REGISTER_ENTRIES_BY_OWNER_QUERY,
  SELF_CAN_MANAGE_QUERY,
  WORKERS_QUERY,
} from '$lib/server/queries';
import { t } from '$lib/i18n/t';
import type { Channel, RegisterEntry } from '$lib/types';
import type { Attendee } from '$lib/register/types';
import { readableInstalledAgents, type InstalledAgent } from '$lib/app-installed-agents';
import { createChannelSchema, deleteChannelSchema, renameChannelSchema } from './channels-schema';

type AppChannels = {
  app: {
    id: string;
    name: string;
    urn: string;
    organizationId?: string | null;
    defaultChannel: { id: string } | null;
    sharedMemory: { id: string; urn: string; name: string } | null;
  } | null;
  channels: { total: number; items: Channel[] };
};


/**
 * #942 slice 2: an App's Channels (spec 049 phase 4).
 *
 * - The list is `channels(filter: {appRef})`: only Channels whose host memory
 *   the caller may read. There's no existence oracle, so there's nothing to
 *   hide here.
 * - The list is paged to completion: `channels` caps at 200 a page, and a
 *   Channel past the first page would otherwise be unmanageable here.
 * - `canWrite` per host memory comes from a SELF-audit (`effectiveAccess`) on
 *   the memory's `hrn:mem:` URN; a bare id would be read as an AiServiceConfig.
 *   It decides whether rename/delete/create are OFFERED; the server's
 *   host-memory write gate still decides whether they succeed. A failed audit
 *   is `null` (unknown): the controls are offered and the server's answer is
 *   shown, rather than hiding a control the caller may well be allowed. That
 *   is the common case until the server admits every self-audit
 *   (hrn:node:hadronmemory.com:specs:cor:acl:060:01, hadron-server#1383):
 *   today a caller who administers neither the memory nor its org gets
 *   FORBIDDEN.
 * - An App-scoped create targets the App's SHARED memory, where its default
 *   `chats:team` lives. Channels in other memories belong to a memory-level
 *   view, not this one.
 */
export async function loadChannelsPanel(want: boolean, client: GraphQLClient, appId: string, locals: App.Locals) {
  if (!want) return null;
  let data: AppChannels;
  try {
    const [{ app }, items] = await Promise.all([
      client.request<Pick<AppChannels, 'app'>>(APP_CHANNELS_APP_QUERY, { ref: appId }),
      fetchAllItems<Channel>(client, APP_CHANNELS_QUERY, 'channels', { appRef: appId }),
    ]);
    data = { app, channels: { total: items.length, items } };
  } catch (e) {
    const code = e instanceof ClientError && e.response.errors?.length ? extractGqlErrorCode(e) : null;
    console.warn(`[app-channels] read failed for app ${appId} (${code ?? 'no code'}):`, e);
    return { kind: 'failed' as const };
  }
  if (!data.app) return { kind: 'failed' as const };

  // Keyed by memory id (what the page looks up); audited by URN.
  // #2509: a concealed host memory (`memory: null`) has no record to audit —
  // its channels skip the map, so their write access stays unknown (null) and
  // the server's write gate still decides any submit.
  const hosts = new Map<string, string>(
    data.channels.items.flatMap((c) => (c.memory ? [[c.memory.id, c.memory.urn] as const] : [])),
  );
  if (data.app.sharedMemory) hosts.set(data.app.sharedMemory.id, data.app.sharedMemory.urn);
  const canWrite: Record<string, boolean | null> = {};
  await Promise.all(
    [...hosts].map(async ([id, urn]) => {
      if (!locals.user) {
        canWrite[id] = null;
        return;
      }
      try {
        const r = await client.request<{ effectiveAccess: { canWrite: boolean } }>(SELF_CAN_WRITE_QUERY, {
          user: locals.user.id,
          resource: urn,
        });
        canWrite[id] = r.effectiveAccess.canWrite;
      } catch (e) {
        console.warn(`[app-channels] write-access check failed for memory ${id}:`, e);
        canWrite[id] = null;
      }
    }),
  );

  const register = await loadRegister(client, data.app, locals.user?.id ?? null, new Set(data.channels.items.map((c) => c.id)));

  return {
    kind: 'ok' as const,
    app: data.app,
    channels: data.channels.items,
    ...register,
    total: data.channels.total,
    defaultChannelId: data.app.defaultChannel?.id ?? null,
    canWrite,
    createForm: await superValidate(zod4(createChannelSchema), { errors: false, id: 'createChannel' }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false, id: 'renameChannel' }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false, id: 'deleteChannel' }),
    ...(await registerForms()),
  };
}

/**
 * #942 slice 3: the register rows this App owns, the organization's rows
 * (shown, never editable here: an App removes only its own rows), the
 * attendees the picker offers (the App's Workers and installed Agents), and
 * whether the caller may manage the App's rows. That last one is a SELF-audit
 * `canManage` on the App's URN, NOT `App.role`, which is the App's default
 * member role (hrn:node:hadronmemory.com:hadron-portal:findings:app-role-is-not-the-callers-role).
 * Like `canWrite`, it is null (unknown) for most callers until
 * hadron-server#1383 admits every self-audit.
 *
 * The rows and the Worker roster are paged to completion: both lists cap at
 * 200 a page, and a row or Worker past it would be silently unmanageable.
 *
 * A failed register read is reported (`registerLoadFailed`), never shown as
 * an empty register: "no rows" and "couldn't read the rows" are different
 * facts.
 */
async function loadRegister(
  client: GraphQLClient,
  app: NonNullable<AppChannels['app']>,
  userId: string | null,
  channelIds: Set<string>,
) {
  const rows = (ownerRef: string) =>
    fetchAllItems<RegisterEntry>(client, REGISTER_ENTRIES_BY_OWNER_QUERY, 'registerEntries', { ownerRef });
  try {
    const [appRows, orgRows, workers, installed, manage] = await Promise.all([
      rows(app.id),
      app.organizationId ? rows(app.organizationId) : Promise.resolve([] as RegisterEntry[]),
      // Retired Workers too: a row that still names one must keep its name.
      // The picker offers only active ones.
      fetchAllItems<{ id: string; name: string; urn: string | null; role: string | null; retiredAt: string | null }>(
        client,
        WORKERS_QUERY,
        'workers',
        { appRef: app.id, includeRetired: true },
      ),
      client.request<{ app: { appAgents: Array<{ agent: InstalledAgent | null }> } | null }>(
        APP_INSTALLED_AGENTS_QUERY,
        { ref: app.id },
      ),
      userId
        ? client
            .request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource: app.urn })
            .then((r) => r.effectiveAccess.canManage)
            .catch((e) => {
              console.warn(`[app-channels] manage check failed for app ${app.id}:`, e);
              return null;
            })
        : Promise.resolve(null),
    ]);
    // portal#1148: a WITHHELD install roster (null) is not "no installed agents".
    const installedAgents = readableInstalledAgents(installed.app?.appAgents);
    const attendees: Attendee[] = [
      ...workers.map((w) => ({ id: w.id, name: w.name, urn: w.urn, kind: 'worker' as const, role: w.role, retired: !!w.retiredAt })),
      ...(installedAgents.kind === 'ok' ? installedAgents.agents : []).map((a) => ({ id: a.id, name: a.name, urn: a.urn, kind: 'agent' as const })),
    ];
    // The org's rows span every App it owns. Only those naming one of THIS
    // App's Channels belong on this page; a row for another App's Channel
    // would otherwise show here, often as "a channel you can't read".
    const ownOrgRows = orgRows.filter((r) => channelIds.has(r.channelId));
    return { appRows, orgRows: ownOrgRows, attendees, canManageRegister: manage as boolean | null, registerLoadFailed: false, agentsWithheld: installedAgents.kind === 'withheld' };
  } catch (e) {
    console.warn(`[app-channels] register read failed for app ${app.id}:`, e);
    return {
      appRows: [] as RegisterEntry[],
      orgRows: [] as RegisterEntry[],
      attendees: [] as Attendee[],
      canManageRegister: null as boolean | null,
      registerLoadFailed: true,
      agentsWithheld: false,
    };
  }
}

/**
 * The words for a refused Channel write. Only codes the server actually emits
 * are mapped (resolvers.channel.ts / lib/channels.ts); anything else, including
 * the untyped `Forbidden`, is the server's own message.
 */
export function channelErrorText(e: unknown, fallback: string): string {
  switch (extractGqlErrorCode(e)) {
    case 'LOC_OVERLAPS_CHANNEL':
      return t('app.channels.error.overlaps', 'That address overlaps an existing channel. Pick another short name.');
    case 'LOC_OCCUPIED':
      return t('app.channels.error.occupied', 'Something that is not a channel already lives at that address. Pick another short name.');
    case 'NOT_FOUND':
      // Missing and unreadable answer the same on purpose (hrn:node:hadronmemory.com:specs:cor:api:140:03).
      return t('app.channels.error.not-found', 'That channel or its memory is not available to you.');
    default:
      return extractGqlError(e, fallback, [], { transport: 'fallback' });
  }
}

