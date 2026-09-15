import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import { fetchOwnedAgents } from '$lib/server/personal-agents';
import { ADD_MEMORY_TO_AGENT_MUTATION, MARKETPLACE_QUERY } from '$lib/server/queries';
import { addMarketplaceMemoryToAgentSchema } from './schema';
import type { Actions, PageServerLoad } from './$types';

/**
 * A sanitized marketplace ref.
 *
 * Two rules govern it, and they are spelled out rather than abbreviated to
 * `…:080:02/04` (@codex and @copilot on #831): a slash suffix is not spec-loc
 * grammar, so that form resolves to neither rule and leaves the reader to infer
 * the second — which is the thing qualification exists to prevent.
 *
 * - `hrn:node:hadronmemory.com:specs:cor:acl:080:02`
 * - `hrn:node:hadronmemory.com:specs:cor:acl:080:04`
 */
export interface MarketplaceRef {
  id: string;
  name: string;
  urn: string;
  description: string | null;
}
interface MarketplaceSection {
  items: MarketplaceRef[];
  total: number;
}
const EMPTY: MarketplaceSection = { items: [], total: 0 };

/** One agent as the adopt picker renders it. */
export interface AdoptTargetAgent {
  id: string;
  name: string;
  urn: string;
}

const addToAgentAdapter = zod4(addMarketplaceMemoryToAgentSchema);
type AddToAgentForm = Infer<typeof addMarketplaceMemoryToAgentSchema, 'zod4'>;

// hrn:node:hadronmemory.com:specs:cor:acl:080:04 — browse the marketplace catalogue (listedOnMarketplace +
// publicly accessible orgs / agents / memories). Public; a token is forwarded
// when present but the server queries require no membership. Loads the first
// page of each section.
export const load: PageServerLoad = async ({ locals }) => {
  // #685 — the adopt picker's options and the catalogue are fetched
  // INDEPENDENTLY, and each reports its own failure. They are not one read:
  // the catalogue is public and the agent list is the caller's, so either can
  // fail while the other succeeds, and collapsing them would let an agent-list
  // outage blank a catalogue that loaded fine.
  const [catalogue, agents] = await Promise.allSettled([
    gqlClient(locals.token).request<{
      marketplaceOrganizations: MarketplaceSection;
      marketplaceAgents: MarketplaceSection;
      marketplaceMemories: MarketplaceSection;
    }>(MARKETPLACE_QUERY, { limit: 60 }),
    fetchOwnedAgents(locals.token),
  ]);

  if (catalogue.status === 'rejected') {
    // #687 — degrade, but SAY SO. See the sibling comment in
    // src/routes/browse/+page.server.ts: the catch stays, but the page is told
    // the difference between "the catalogue is empty" and "we could not read
    // it", instead of both arriving as EMPTY sections.
    //
    // One query backs all three sections, so one flag is the honest shape —
    // a per-section flag would imply the sections can fail independently.
    console.error('[marketplace] catalogue query failed; reporting it to the page', catalogue.reason);
  }
  if (agents.status === 'rejected') {
    // #685 — the SAME distinction, one surface over. "You have no agents yet"
    // is a claim about the caller's account; rendering it because the query
    // threw would send someone off to create an agent they already own
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    console.error('[marketplace] owned-agents query failed; reporting it to the page', agents.reason);
  }

  const sections = catalogue.status === 'fulfilled'
    ? catalogue.value
    : { marketplaceOrganizations: EMPTY, marketplaceAgents: EMPTY, marketplaceMemories: EMPTY };

  return {
    organizations: sections.marketplaceOrganizations,
    agents: sections.marketplaceAgents,
    memories: sections.marketplaceMemories,
    loadFailed: catalogue.status === 'rejected',
    // Only the caller's OWN (user-owned) agents. See the `addToAgent` action
    // for why the picker stops there rather than including org agents.
    adoptTargets: agents.status === 'fulfilled'
      ? agents.value.map(({ id, name, urn }): AdoptTargetAgent => ({ id, name, urn }))
      : ([] as AdoptTargetAgent[]),
    adoptTargetsFailed: agents.status === 'rejected',
    // No load-time form object: the adopt forms are plain POSTs with no client
    // Superforms instance (see the comment in +page.svelte for why the enhanced
    // single-form version was wrong). The ACTION still validates through
    // `superValidate`, which is what produces the ActionData the page reads.
  };
};

export const actions: Actions = {
  /**
   * #685 — adopt a marketplace memory by attaching it to one of the caller's
   * agents. This restores a call to action to a catalogue that had none since
   * #681 removed the dead `addToMyMemories` button.
   *
   * WHY THIS MUTATION. #685 listed three candidate meanings for "adopt" and
   * asked which one it is. Two of the three cannot be built today, which is
   * what settles it rather than a preference:
   *
   * - a user-scoped `MemorySubscription` does not exist — the row is keyed
   *   `@@unique([memoryId, organizationId])` with no user column, which is the
   *   gap that retired `addToMyMemories` with spec 048's personal orgs;
   * - `createMemoryShare` is a grant BY an owner, gated on
   *   `isMemorySharePrincipal` (a bare `memory.userId === ctx.userId`), so a
   *   reader can never use it to adopt someone else's memory;
   * - `addMemoryToAgent` works, today, for exactly this caller.
   *
   * It is also what the marketplace's own copy always promised — "give your AI
   * agent instant expertise" — restored on the page alongside this.
   *
   * WHY ONLY THE CALLER'S OWN AGENTS. `requireOwnerOrOrgRole` admits a
   * user-owned agent on the OWNER path (`ownerUserId === ctx.userId`), with no
   * role lookup — so every option this picker offers is one the server will
   * accept. Widening it to org agents would list agents whose attach succeeds
   * only for an org ADMIN, i.e. options that are refusals for an ordinary
   * member (hrn:node:hadronmemory.com:hadron-portal:review:derived-options-are-suggestions). Org agents already have a
   * working attach control on their own detail page; this is the discovery
   * entry point, not a second one.
   */
  addToAgent: async ({ request, locals }) => {
    const form = await superValidate<AddToAgentForm>(await request.formData(), addToAgentAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentRef: form.data.agentId,
        memoryRef: form.data.memoryId,
        // Sent explicitly rather than omitted. The resolver's `role ?? 'read'`
        // would produce the same row today, but the portal's intent here is
        // read-only knowledge, and a default that lives only on the server is
        // one deploy away from meaning something else.
        role: 'read',
      });
      // Deliberately does not claim the memory was NEWLY added: the server's
      // upsert is idempotent (#501), so this same success covers re-attaching
      // one the agent already had, and a message promising more than the call
      // establishes is hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee.
      return message(form, {
        type: 'success',
        text: t('marketplace.adopt.success', 'Added to your agent.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          // The FALLBACK goes through t(); the server's own GraphQL message is
          // passed through untranslated, because it is the server's sentence
          // and not ours to restate (hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper —
          // and #837, where this exact line was the miss).
          text: extractGqlError(
            e,
            t('marketplace.adopt.error', 'Failed to add this memory to your agent'),
          ),
        },
        { status: 500 },
      );
    }
  },
};
