import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
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
import { t } from '$lib/i18n/t';
import type { Channel, RegisterEntry } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  addAttendanceSchema,
  channelLoc,
  createChannelSchema,
  deleteChannelSchema,
  editAttendanceSchema,
  removeAttendanceSchema,
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
 * - `canWrite` per host memory comes from a SELF-audit (`effectiveAccess`,
 *   always allowed). It decides whether rename/delete/create are OFFERED; the
 *   server's host-memory write gate still decides whether they succeed. A
 *   failed audit is `null` (unknown): the controls are offered and the
 *   server's answer is shown, rather than hiding a control the caller may
 *   well be allowed.
 * - An App-scoped create targets the App's SHARED memory, where its default
 *   `chats:team` lives. Channels in other memories belong to a memory-level
 *   view, not this one.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  let data: AppChannels;
  try {
    data = await client.request<AppChannels>(APP_CHANNELS_QUERY, { ref: params.appId, appRef: params.appId });
  } catch (e) {
    // An App the caller cannot see answers as a missing one on both fields.
    if (extractGqlErrorCode(e) === 'NOT_FOUND') throw error(404, 'App not found');
    throw e;
  }
  if (!data.app) throw error(404, 'App not found');

  const hostIds = new Set<string>(data.channels.items.map((c) => c.memory.id));
  if (data.app.sharedMemory) hostIds.add(data.app.sharedMemory.id);
  const canWrite: Record<string, boolean | null> = {};
  await Promise.all(
    [...hostIds].map(async (id) => {
      if (!locals.user) {
        canWrite[id] = null;
        return;
      }
      try {
        const r = await client.request<{ effectiveAccess: { canWrite: boolean } }>(SELF_CAN_WRITE_QUERY, {
          user: locals.user.id,
          resource: id,
        });
        canWrite[id] = r.effectiveAccess.canWrite;
      } catch (e) {
        console.warn(`[app-channels] write-access check failed for memory ${id}:`, e);
        canWrite[id] = null;
      }
    }),
  );

  const register = await loadRegister(client, data.app, locals.user?.id ?? null);

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
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
  };
};

export type Attendee = { id: string; name: string; urn: string | null; kind: 'worker' | 'agent'; role?: string | null };

/**
 * #942 slice 3: the register rows this App owns, the organization's rows
 * (shown, never editable here: an App removes only its own rows), the
 * attendees the picker offers (the App's Workers and installed Agents), and
 * whether the caller may manage the App's rows. That last one is a SELF-audit
 * `canManage` on the App, NOT `App.role`, which is the App's default member
 * role (hrn:node:hadronmemory.com:hadron-portal:findings:app-role-is-not-the-callers-role).
 *
 * A failed register read is reported (`registerLoadFailed`), never shown as
 * an empty register: "no rows" and "couldn't read the rows" are different
 * facts.
 */
async function loadRegister(
  client: ReturnType<typeof gqlClient>,
  app: NonNullable<AppChannels['app']>,
  userId: string | null,
) {
  const rows = (ownerRef: string) =>
    client
      .request<{ registerEntries: { items: RegisterEntry[] } }>(REGISTER_ENTRIES_BY_OWNER_QUERY, { ownerRef })
      .then((r) => r.registerEntries.items);
  try {
    const [appRows, orgRows, workers, installed, manage] = await Promise.all([
      rows(app.id),
      app.organizationId ? rows(app.organizationId) : Promise.resolve([] as RegisterEntry[]),
      client.request<{ workers: { items: Array<{ id: string; name: string; urn: string | null; role: string | null }> } }>(
        WORKERS_QUERY,
        { appRef: app.id, limit: 200 },
      ),
      client.request<{ app: { appAgents: Array<{ agent: { id: string; name: string; urn: string } }> } | null }>(
        APP_INSTALLED_AGENTS_QUERY,
        { ref: app.id },
      ),
      userId
        ? client
            .request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource: app.id })
            .then((r) => r.effectiveAccess.canManage)
            .catch((e) => {
              console.warn(`[app-channels] manage check failed for app ${app.id}:`, e);
              return null;
            })
        : Promise.resolve(null),
    ]);
    const attendees: Attendee[] = [
      ...workers.workers.items.map((w) => ({ id: w.id, name: w.name, urn: w.urn, kind: 'worker' as const, role: w.role })),
      ...(installed.app?.appAgents ?? []).map((a) => ({ id: a.agent.id, name: a.agent.name, urn: a.agent.urn, kind: 'agent' as const })),
    ];
    return { appRows, orgRows, attendees, canManageRegister: manage as boolean | null, registerLoadFailed: false };
  } catch (e) {
    console.warn(`[app-channels] register read failed for app ${app.id}:`, e);
    return {
      appRows: [] as RegisterEntry[],
      orgRows: [] as RegisterEntry[],
      attendees: [] as Attendee[],
      canManageRegister: null as boolean | null,
      registerLoadFailed: true,
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
      // Missing and unreadable answer the same on purpose (cor:api:140:03).
      return t('app.channels.error.not-found', 'That channel or its memory is not available to you.');
    default:
      return extractGqlError(e, fallback);
  }
}

/** The words for a refused register write: the codes lib/register.ts emits, else the server's own. */
function registerErrorText(e: unknown, fallback: string): string {
  switch (extractGqlErrorCode(e)) {
    case 'REGISTER_ENTRY_EXISTS':
      return t('app.channels.register.error.exists', 'That attendee already takes part in that channel. Edit the existing row instead.');
    case 'NOT_FOUND':
      return t('app.channels.register.error.not-found', 'That row is not available to you.');
    default:
      return extractGqlError(e, fallback);
  }
}

export const actions: Actions = {
  addAttendance: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(addAttendanceSchema));
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(CREATE_REGISTER_ENTRY_MUTATION, {
        input: {
          ownerRef: params.appId,
          channelRef: form.data.channelId,
          // Empty = every attendee in the App; the server resolves a Worker
          // first, then an Agent installed here, and refuses anything else.
          attendeeRef: form.data.attendee || null,
          role: form.data.role,
          mentionOnly: form.data.mentionOnly,
          description: form.data.description || null,
        },
      });
    } catch (e) {
      return message(form, { type: 'error', text: registerErrorText(e, 'The attendance could not be added.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.register.added', 'Attendance added.') });
  },

  editAttendance: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), zod4(editAttendanceSchema));
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(UPDATE_REGISTER_ENTRY_MUTATION, {
        ref: form.data.ref,
        input: { role: form.data.role, mentionOnly: form.data.mentionOnly, description: form.data.description },
      });
    } catch (e) {
      return message(form, { type: 'error', text: registerErrorText(e, 'The attendance could not be updated.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.register.updated', 'Attendance updated.') });
  },

  removeAttendance: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), zod4(removeAttendanceSchema));
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(DELETE_REGISTER_ENTRY_MUTATION, { ref: form.data.ref });
    } catch (e) {
      return message(form, { type: 'error', text: registerErrorText(e, 'The attendance could not be removed.') }, { status: 400 });
    }
    return message(form, { type: 'success', text: t('app.channels.register.removed', 'Attendance removed.') });
  },

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
        return message(form, { type: 'error', text: t('app.channels.error.no-host', 'This App has no shared memory to hold a channel.') }, { status: 400 });
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
