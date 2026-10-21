import { error, fail } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { fetchAllItems } from '$lib/server/paginate';
import { attendanceActions, registerForms } from '$lib/server/register-actions';
import {
  APP_CHANNELS_APP_QUERY,
  APP_CHANNELS_QUERY,
  APP_SHARED_MEMORY_QUERY,
  CREATE_CHANNEL_MUTATION,
  DELETE_CHANNEL_MUTATION,
  SELF_CAN_WRITE_QUERY,
  UPDATE_CHANNEL_MUTATION,
  APP_INSTALLED_AGENTS_QUERY,
  REGISTER_ENTRIES_BY_OWNER_QUERY,
  SELF_CAN_MANAGE_QUERY,
  WORKERS_QUERY,
} from '$lib/server/queries';
import { t } from '$lib/i18n/t';
import type { Channel, RegisterEntry } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  channelLoc,
  createChannelSchema,
  deleteChannelSchema,
  renameChannelSchema,
} from './schema';

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
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  let data: AppChannels;
  try {
    const [{ app }, items] = await Promise.all([
      client.request<Pick<AppChannels, 'app'>>(APP_CHANNELS_APP_QUERY, { ref: params.appId }),
      fetchAllItems<Channel>(client, APP_CHANNELS_QUERY, 'channels', { appRef: params.appId }),
    ]);
    data = { app, channels: { total: items.length, items } };
  } catch (e) {
    // An App the caller cannot see answers as a missing one on both fields.
    const code = e instanceof ClientError && e.response.errors?.length ? extractGqlErrorCode(e) : null;
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN') throw error(404, 'App not found');
    throw e;
  }
  if (!data.app) throw error(404, 'App not found');

  // Keyed by memory id (what the page looks up); audited by URN.
  const hosts = new Map<string, string>(data.channels.items.map((c) => [c.memory.id, c.memory.urn]));
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
    app: data.app,
    channels: data.channels.items,
    ...register,
    total: data.channels.total,
    defaultChannelId: data.app.defaultChannel?.id ?? null,
    canWrite,
    createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
    ...(await registerForms()),
  };
};

export type { Attendee } from '$lib/register/types';
import type { Attendee } from '$lib/register/types';
import { readableInstalledAgents, type InstalledAgent } from '$lib/app-installed-agents';

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
  client: ReturnType<typeof gqlClient>,
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
function channelErrorText(e: unknown, fallback: string): string {
  switch (extractGqlErrorCode(e)) {
    case 'LOC_OVERLAPS_CHANNEL':
      return t('app.channels.error.overlaps', 'That address overlaps an existing channel. Pick another short name.');
    case 'LOC_OCCUPIED':
      return t('app.channels.error.occupied', 'Something that is not a channel already lives at that address. Pick another short name.');
    case 'NOT_FOUND':
      // Missing and unreadable answer the same on purpose (hrn:node:hadronmemory.com:specs:cor:api:140:03).
      return t('app.channels.error.not-found', 'That channel or its memory is not available to you.');
    default:
      return extractGqlError(e, fallback);
  }
}

export const actions: Actions = {
  // #942: the register writes, shared with the organization's Channels page.
  ...attendanceActions((params) => params.appId),

  createChannel: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(createChannelSchema));
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);
    try {
      const { app } = await client.request<{ app: { id: string; sharedMemory: { id: string } | null } | null }>(
        APP_SHARED_MEMORY_QUERY,
        { ref: params.appId },
      );
      if (!app?.sharedMemory) {
        return message(form, { type: 'error', text: t('app.channels.error.no-host', 'This App’s shared memory, where its channels live, isn’t available to you.') }, { status: 400 });
      }
      await client.request(CREATE_CHANNEL_MUTATION, {
        input: {
          memoryRef: app.sharedMemory.id,
          loc: channelLoc(form.data.slug),
          name: form.data.name,
          description: form.data.description || null,
        },
      });
    } catch (e) {
      return message(form, { type: 'error', text: channelErrorText(e, 'The channel could not be created.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.created', 'Channel created.') });
  },

  renameChannel: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), zod4(renameChannelSchema));
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(UPDATE_CHANNEL_MUTATION, {
        ref: form.data.ref,
        // An emptied description clears it; the server trims and stores null.
        input: { name: form.data.name, description: form.data.description },
      });
    } catch (e) {
      return message(form, { type: 'error', text: channelErrorText(e, 'The channel could not be renamed.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.renamed', 'Channel updated.') });
  },

  deleteChannel: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), zod4(deleteChannelSchema));
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(DELETE_CHANNEL_MUTATION, { ref: form.data.ref });
    } catch (e) {
      return message(form, { type: 'error', text: channelErrorText(e, 'The channel could not be deleted.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.deleted', 'Channel deleted.') });
  },
};
