import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import {
  UPDATE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUSH_MEMORY_TO_GIT_MUTATION,
} from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  memoryIntegrationSchema,
  pushMemoryIntegrationSchema,
  syncMemoryIntegrationSchema,
} from './schema';
import { syncOutcomeMessage, type SyncOutcomeFields } from '$lib/sync-report';
import { gitFailureMessage } from '$lib/sync-error';

const memoryIntegrationFormAdapter = zod4(memoryIntegrationSchema);
const pushMemoryIntegrationFormAdapter = zod4(pushMemoryIntegrationSchema);
const syncMemoryIntegrationFormAdapter = zod4(syncMemoryIntegrationSchema);
type MemoryIntegrationForm = Infer<typeof memoryIntegrationSchema, 'zod4'>;
type PushMemoryIntegrationForm = Infer<typeof pushMemoryIntegrationSchema, 'zod4'>;
type SyncMemoryIntegrationForm = Infer<typeof syncMemoryIntegrationSchema, 'zod4'>;

function integrationFormDefaults(memory: Memory) {
  return {
    source: memory.source ?? '',
    readBranch: memory.readBranch ?? '',
    writeBranch: memory.writeBranch ?? '',
  };
}

function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

// This is a mutating edit surface (update/sync/push), so — like /settings —
// keep consumer-mode users out of it.
export const load: PageServerLoad = async ({ parent }) => {
  // Avoid re-invoking parent(); the guard and the form defaults need the same
  // layout payload.
  const parentDataPromise = parent();
  await requireNonConsumer(() => parentDataPromise);
  const { graph } = await parentDataPromise;
  const [form, syncForm, pushForm] = await Promise.all([
    superValidate<MemoryIntegrationForm>(
      integrationFormDefaults(graph),
      memoryIntegrationFormAdapter,
      { errors: false },
    ),
    superValidate<SyncMemoryIntegrationForm>(
      {},
      syncMemoryIntegrationFormAdapter,
      { errors: false, id: 'syncMemory' },
    ),
    superValidate<PushMemoryIntegrationForm>(
      {},
      pushMemoryIntegrationFormAdapter,
      { errors: false, id: 'pushMemory' },
    ),
  ]);
  return {
    form,
    syncForm,
    pushForm,
  };
};

// #266: the GitHub integration (source + branches) and sync/push actions split
// out of the Settings page into their own tab. This `update` touches ONLY the
// integration fields so it can't clobber memory metadata (and the Settings
// `update` no longer touches these fields).
export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const form = await superValidate<MemoryIntegrationForm>(
      await request.formData(),
      memoryIntegrationFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.id,
        source: blankToNull(form.data.source),
        readBranch: blankToNull(form.data.readBranch),
        writeBranch: blankToNull(form.data.writeBranch),
      });
      return message(form, { type: 'success', text: t('integrations.saved', 'Changes saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update integration') },
        { status: 500 },
      );
    }
  },

  sync: async ({ request, params, locals }) => {
    const form = await superValidate<SyncMemoryIntegrationForm>(
      await request.formData(),
      syncMemoryIntegrationFormAdapter,
      { id: 'syncMemory' },
    );
    if (!form.valid) return fail(400, { form });

    // #988: the outcome follows what the server RETURNED, never the mere
    // absence of an error: a sync that stops early comes back still SYNCING
    // (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee).
    // A failure's text is the raw git error, which can carry credentials
    // (hadron-server#1578), so it is classified into fixed copy and never
    // shown ($lib/sync-error).
    try {
      const res = await gqlClient(locals.token).request<{ syncMemory: SyncOutcomeFields | null }>(
        SYNC_MEMORY_MUTATION, { id: params.id },
      );
      const outcome = syncOutcomeMessage(res.syncMemory);
      return message(form, outcome, outcome.type === 'error' ? { status: 500 } : undefined);
    } catch (e: unknown) {
      return message(form, { type: 'error', text: gitFailureMessage(extractGqlError(e, ''), 'sync') }, { status: 500 });
    }
  },

  pushToGit: async ({ request, params, locals }) => {
    const form = await superValidate<PushMemoryIntegrationForm>(
      await request.formData(),
      pushMemoryIntegrationFormAdapter,
      { id: 'pushMemory' },
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(PUSH_MEMORY_TO_GIT_MUTATION, { id: params.id });
      return message(form, { type: 'success', text: t('integrations.pushed', 'Pushed to Git.') });
    } catch (e: unknown) {
      // #988: the push path uses the same tokenized remote (hadron-server#1578).
      return message(form, { type: 'error', text: gitFailureMessage(extractGqlError(e, ''), 'push') }, { status: 500 });
    }
  },
};
