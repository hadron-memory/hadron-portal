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
} from '$lib/server/queries';
import { t } from '$lib/i18n/t';
import type { Channel } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { channelLoc, createChannelSchema, deleteChannelSchema, renameChannelSchema } from './schema';

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

  return {
    app: data.app,
    channels: data.channels.items,
    total: data.channels.total,
    defaultChannelId: data.app.defaultChannel?.id ?? null,
    canWrite,
    createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
  };
};

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

export const actions: Actions = {
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
