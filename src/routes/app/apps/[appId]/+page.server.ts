import { readChannelPage, postToChannel } from '$lib/server/channel-chat';
import { withRegisteredChannels } from '$lib/app-chats';

import { createMemory, readAppMemories, canCreateAppMemory } from './app-memories';
import { writeCustomisation } from '$lib/server/install-customisation';
import { deleteWorkerSchema } from './schema';
import type { DeleteWorkerResult } from './delete-worker';

import { fail, error, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { appKeyRefusal } from '$lib/server/app-key-refusal';
import { agentToolsRefusal } from './agent-tools-refusal';
import { gqlClient } from '$lib/server/api';
import { pointerAction, readAppPointers } from '$lib/server/boot-prompt-pointer';
import { appAgentPointerKey } from '$lib/boot-prompt-pointer';
import { lookupOwn } from '$lib/lookup';
import { loadAppTeamRoster } from '$lib/server/app-team-roster';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError, extractGqlErrorCode, gqlErrorBody } from '$lib/server/gqlError';
import { loadOrgDetail } from '$lib/server/org-detail';
import { mergeInstallableAgents, type OrgAgentPool } from '$lib/server/installable-agents';
import { t } from '$lib/i18n/t';
import {
  APP_DETAIL_ORG_QUERY,
  APP_ORG_AGENTS_QUERY,
  APP_ORG_AGENT_GRANTS_QUERY,
  APP_QUERY,
  APP_MEMBERS_QUERY,
  SELF_CAN_MANAGE_QUERY,
  SET_APP_AGENT_BOOT_PROMPT_MUTATION,
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  UPDATE_APP_MUTATION,
  INSTALL_AGENT_INTO_APP_MUTATION,
  UNINSTALL_AGENT_FROM_APP_MUTATION,
  CREATE_APP_KEY_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  APP_NODES_QUERY,
  APP_CHANNELS_QUERY,
  AI_SERVICE_CONFIGS_QUERY,
  RESOLVE_AI_SERVICE_CONFIGS_QUERY,
  WORKERS_QUERY,
  CAST_WORKER_MUTATION,
  RETIRE_WORKER_MUTATION,
  DELETE_WORKER_MUTATION,
  SET_WORKER_WAKE_SETTINGS_MUTATION,
  RELEASE_WORKER_MUTATION,
  TEAM_CHAT_MESSAGES_QUERY,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  TEAM_WORK_ITEMS_QUERY,
  APP_CHAT_ROOTS_QUERY,
} from '$lib/server/queries';
import { normalizeFilter, normalizeKind } from '$lib/components/worklog';
// AGENT_CHAT_KEY / TEAM_CHAT_LOC moved out with RETIRED_TAB_ALIASES into
// `tab-intent.ts`; they have no other reader here.
import {
  buildAppChatList,
  chatFullViewFromParams,
  resolveSelectedChat,
} from '$lib/app-chats';
import { loadTeamChatTail, teamChatRefusalOf } from '$lib/server/team-chat';
import { NO_TEAM_FILTER, parseTeamParam } from '$lib/team-chat-filter';
import { loadChatMessages } from '$lib/server/team-chat';
import { resolveTabIntent } from './tab-intent';
import {
  addMember,
  addAppMemberFormAdapter,
  ensureMember,
  ensureAppMemberFormAdapter,
  removeMember,
  removeAppMemberFormAdapter,
} from './member-actions';
import type {
  Organization,
  App,
  AppMember,
  MemoryNode,
  AiServiceConfig,
  Worker,
  TeamChatMessage,
  TeamWorkItem,
} from '$lib/types';
import { loadAppKeyScopes } from '$lib/server/tickers';
import { loadAppKeys, loadViewerManages } from '$lib/server/app-keys';
import type { Actions, PageServerLoad } from './$types';
import {
  createAppMemorySchema,
  addAgentSchema,
  appSettingsSchema,
  castWorkerSchema,
  createAppKeySchema,
  deleteAppSchema,
  removeAppAgentSchema,
  postTeamChatMessageSchema,
  retireWorkerSchema,
  releaseWorkerSchema,
  revokeAppKeySchema,
  updateAppAgentToolsSchema,
} from './schema';
import { isCapped } from '$lib/server/capped';
import { loadLiveStops } from '$lib/server/stop-signals';
import type { ReleaseWorkerMessage } from './schema';

// appNodes and the chat-root read take a limit but have no continuation
// (hadron-server#2212), so each fetches one window and says when it came back full.
const APP_NODES_LIMIT = 500;
const APP_CHAT_ROOTS_LIMIT = 200;
import { readHoldStale, type HoldStale } from './hold-stale';

type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
type CastWorkerForm = Infer<typeof castWorkerSchema, 'zod4'>;
type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;
type DeleteAppForm = Infer<typeof deleteAppSchema, 'zod4'>;
type PostTeamChatMessageForm = Infer<typeof postTeamChatMessageSchema, 'zod4'>;
type RemoveAppAgentForm = Infer<typeof removeAppAgentSchema, 'zod4'>;
type RetireWorkerForm = Infer<typeof retireWorkerSchema, 'zod4'>;
type ReleaseWorkerForm = Infer<typeof releaseWorkerSchema, 'zod4'>;
type RevokeAppKeyForm = Infer<typeof revokeAppKeySchema, 'zod4'>;
type UpdateAppAgentToolsForm = Infer<typeof updateAppAgentToolsSchema, 'zod4'>;

/**
 * The agent fields the install picker draws: `{a.name} ({a.urn})`, keyed by
 * `a.id`. Shared by all three sources — the org's agents, the caller's own
 * personal agents, and PUBLIC agents — because the `<select>` renders them
 * identically.
 */
type InstallableAgent = { id: string; name: string; urn: string };

/**
 * What this loader puts on `data.org` (#851): the chrome three, plus the
 * members the AI-config manager's `canManage` reads.
 *
 * A SLICE of Organization rather than Organization, for the reason `OrgChrome`
 * in `/app/orgs/[id]/+layout.server.ts` is one: a consumer that starts reading
 * `org.memories` or `org.exchangeConnections` off this payload must fail to
 * COMPILE rather than read undefined at runtime. Typing it as the full entity
 * while fetching a slice is a lie the compiler would help maintain.
 *
 * It earned that keep immediately: `members` is on this list only because
 * narrowing the type failed to compile against `+page.svelte`'s
 * `members={org?.members ?? []}`, which my own grep census had missed — the
 * pattern I searched for required `org.`, and optional chaining writes `org?.`.
 * The compiler is an exhaustive census; a regex is a guess about spelling
 * (`hrn:node:hadronmemory.com:hadron-portal:findings:a-measurement-is-only-as-good-as-its-question`).
 */
type AppOrg = Pick<Organization, 'id' | 'name' | 'urn' | 'members'>;

// Route-local, but a `/* GraphQL */` const rather than an inline string so
// `pnpm gql:validate` sees it — an inline document is invisible to the gate
// (#690 review), which is how this one kept `ref: $id` after the sweep.
const APP_ORG_QUERY = /* GraphQL */ `
  query AppOrg($ref: ID!) {
    app(ref: $ref) {
      organizationId
    }
  }
`;

const addAgentFormAdapter = zod4(addAgentSchema);
const appSettingsFormAdapter = zod4(appSettingsSchema);
const castWorkerFormAdapter = zod4(castWorkerSchema);
const createAppKeyFormAdapter = zod4(createAppKeySchema);
const deleteAppFormAdapter = zod4(deleteAppSchema);

const postTeamChatMessageFormAdapter = zod4(postTeamChatMessageSchema);
const removeAppAgentFormAdapter = zod4(removeAppAgentSchema);
const retireWorkerFormAdapter = zod4(retireWorkerSchema);
const releaseWorkerFormAdapter = zod4(releaseWorkerSchema);
const revokeAppKeyFormAdapter = zod4(revokeAppKeySchema);
const updateAppAgentToolsFormAdapter = zod4(updateAppAgentToolsSchema);

/**
 * Staffing is gated server-side on a three-branch OR (an org member with
 * CONTRIBUTOR+ on the App's org, a non-`reader` AppMember of an org-owned App,
 * or the owner of a user-owned App — never under impersonation). The portal
 * deliberately does NOT re-derive that predicate to pre-hide the controls:
 *
 *   - `App.role` is the App's DEFAULT member role column (it feeds the Settings
 *     form), NOT the caller's role — gating on it would hide casting from an
 *     org CONTRIBUTOR/ADMIN who isn't an AppMember at all, i.e. the primary
 *     intended caller.
 *   - A wrong guess in the hiding direction is worse than one in the showing
 *     direction: a hidden control is an unexplained dead end, a refused one is
 *     a sentence. The server's gate IS the auth (see the loader's note on
 *     `app(ref:)`), and duplicating it here is exactly the drift this repo
 *     avoids elsewhere.
 *
 * So a caller who can't staff learns it from a legible refusal rather than a
 * raw server string. Raised by Codex on PR #716.
 */
const STAFFING_FORBIDDEN = () => t(
  'app.staff.error.forbidden',
  'You don’t have permission to staff this App. Casting and retiring need contributor access to the organization, or a non-reader role in the App.',
);

/**
 * releaseWorker's refusal, which does NOT share the staffing gate above.
 *
 * `releaseWorker` admits exactly two principals, and they are different acts:
 * the HOLDER releasing their own name, or an App/org ADMIN force-releasing
 * somebody else's. Casting and retiring admit a third — a contributor, or a
 * non-reader App member — so reusing STAFFING_FORBIDDEN here told a contributor
 * who is not the holder that they already have the access they need, which is
 * the one thing a permission message must never do (@codex and @copilot, both,
 * on #766).
 */
const RELEASE_FORBIDDEN = () => t(
  'app.staff.error.release-forbidden',
  'You don’t have permission to release this name. You can release a name you hold yourself; force-releasing someone else’s needs admin access to the App or its organization.',
);

/**
 * The half of `ReleaseWorkerPayload` this action reads (#823).
 *
 * `worker` and `forced` are selected — the mirrored SDL and
 * `release-worker-query.test.ts` pin all four — but deliberately not read here:
 *
 *   - `worker` is a re-read of CURRENT state, so a non-null `heldByUserId` on it
 *     is a LATER hold somebody else took, never a failed release. `releasedFrom`
 *     is what says the release happened, and mixing the two would let a race
 *     report a successful release as a failure.
 *   - `forced` does not change the copy. The confirm dialog already states the
 *     admin path and its team-chat post BEFORE the click, and repeating it
 *     afterwards tells the reader nothing they did not just agree to. Where it
 *     does matter — an owed announcement that failed — `notified: false` says so
 *     directly, and `notified` is non-null only on the forced path anyway.
 */
type ReleaseWorkerPayload = {
  releasedFrom: { id: string } | null;
  notified: boolean | null;
};

/**
 * #823 — three outcomes, three messages, each describing what the server
 * reported doing rather than what the click asked for
 * (`hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`).
 *
 * The action used to discard the result and always say "Name released.", which
 * is false twice over: `releaseWorker` is idempotent on an unheld worker, and
 * `notified: false` means the announcement
 * `hrn:node:hadronmemory.com:specs:cor:agt:020:09` requires was OWED AND FAILED — the one case where somebody else is relying on a post that never
 * went out, rendered as plain success.
 *
 * No user-supplied value is interpolated into any of these strings. Naming the
 * holder would want `t(...).replace('{who}', handle)`, and that expands `$&` and
 * friends out of a user-chosen handle (#817, 35 existing sites). The roster row
 * the click came from already names them, so the sentence loses nothing.
 *
 * None of them promises the name is AVAILABLE, either — @codex on #824, and the
 * claim was in all three rather than the one line it flagged. The old copy ended
 * "anyone may hold it now", which is a statement about a mutable global at the
 * moment the sentence is READ: the payload's own contract says `worker`'s
 * `heldByUserId` may carry a LATER hold, so a reader can be told the name is
 * theirs for the taking and then refused `WORKER_HELD` on the very next click.
 * The type comment above says exactly that, and the copy under it contradicted
 * it. What IS observed is that a hold ended, and that releasing reserves nothing
 * — so the messages say a released name goes to whoever binds it next, which
 * stays true whoever that turns out to be.
 */
function releaseOutcomeMessage(payload: ReleaseWorkerPayload): ReleaseWorkerMessage {
  // `releasedFrom` is null exactly when nothing was released — the SDL states it
  // as the idempotent path, and it is the value the guarded write matched on
  // rather than one a pre-read saw.
  if (!payload.releasedFrom) {
    return {
      type: 'success',
      outcome: 'not-held',
      text: t(
        'app.staff.release.not-held',
        'Nothing to release — nobody held that name. The worker stays active and keeps its name, and the name goes to whoever binds it next.',
      ),
    };
  }

  // Strictly `=== false`: `null` means no notice was owed (a self-release), and
  // treating a falsy null as a failure would warn about an announcement nobody
  // ever expected.
  if (payload.notified === false) {
    return {
      type: 'success',
      outcome: 'announcement-failed',
      text: t(
        'app.staff.release.announcement-failed',
        'Name released — but the team-chat announcement did not post. The hold ended and the name goes to whoever binds it next; the team has no notice of it from Hadron, so tell them yourself.',
      ),
    };
  }

  return {
    type: 'success',
    outcome: 'released',
    text: t(
      'app.staff.release.success',
      'Name released. The worker stays active and keeps its name; the hold on it ended, and the name goes to whoever binds it next.',
    ),
  };
}

/**
 * #825 — what to say when the guarded release REFUSED because the hold is not
 * what the roster showed.
 *
 * Three readings, because the right sentence differs by who holds it now, and
 * `callerId` is the only thing that can tell them apart: the server throws
 * before comparing the holder to the caller, and deliberately does not say
 * whose hold it is. That neutrality must not be rendered as an accusation.
 *
 * Nothing was released on ANY of these paths. What differs is whether the user
 * still has something to do:
 *
 *   - nobody holds it     — the end state they wanted already stands, so this
 *                           is not an error to act on. Reported as the
 *                           `not-held` outcome, in neutral chrome.
 *   - the caller holds it — releasing is now a SELF-release, which owes nobody
 *                           notice. Saying "force-release" here would be the
 *                           #766 mistake: describing an act the user is not
 *                           about to perform.
 *   - somebody else does  — force-releasing would announce THEM
 *                           (`hrn:node:hadronmemory.com:specs:cor:agt:020:09`),
 *                           and they are not who the admin agreed to release.
 *
 * None of the three states who holds the name NOW as a present fact — each
 * reports what the server found when it refused. The distinction is the arm
 * #824 added to
 * `hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`.
 */
function staleHoldMessage(stale: HoldStale & object, callerId: string | null): ReleaseWorkerMessage {
  if (stale.kind === 'unheld') {
    return {
      type: 'success',
      outcome: 'not-held',
      staleHold: true,
      text: t(
        'app.staff.release.stale.unheld',
        'Nothing to release — the hold this was aimed at had already ended. The worker stays active and keeps its name, and the name goes to whoever binds it next. The list has been refreshed.',
      ),
    };
  }

  if (callerId && stale.holderId === callerId) {
    return {
      type: 'error',
      staleHold: true,
      text: t(
        'app.staff.release.stale.mine',
        'Nothing was released. The hold changed after this list was drawn, and the name is now held under your own account — so releasing it is no longer the admin act this list offered. The list has been refreshed; release it again if that is what you want.',
      ),
    };
  }

  return {
    type: 'error',
    staleHold: true,
    text: t(
      'app.staff.release.stale.other',
      'Nothing was released. The hold changed after this list was drawn, and the server found a different holder than the one this click named. Force-releasing announces the holder in the team chat, so it was refused rather than applied to somebody you did not choose. The list has been refreshed — check who holds it before clicking again.',
    ),
  };
}

/**
 * castWorker's typed refusals (#974), mapped to copy that says what to DO.
 * The raw server message names internals ("no installed agent matches role
 * X"), and the codes are a documented contract, so branching on the code is
 * both stabler and more actionable than echoing the message.
 */
const CAST_WORKER_ERRORS: Record<string, () => string> = {
  FORBIDDEN: STAFFING_FORBIDDEN,
  WORKER_NAME_TAKEN: () => t(
    'app.staff.error.name-taken',
    'That name is already taken in this App. Worker names are reserved permanently, including for retired workers — pick another.',
  ),
  WORKER_AGENT_NOT_INSTALLED: () => t(
    'app.staff.error.agent-not-installed',
    'That agent is not installed in this App. Install it first, then cast it.',
  ),
  WORKER_AGENT_NOT_FOUND: () => t(
    'app.staff.error.agent-not-found',
    'No installed agent matches that role. Pick an agent explicitly.',
  ),
  WORKER_AGENT_AMBIGUOUS: () => t(
    'app.staff.error.agent-ambiguous',
    'Several installed agents match that role. Pick an agent explicitly.',
  ),
  WORKER_ROLE_OVERRIDE_REFUSED: () => t(
    'app.staff.error.role-override-refused',
    'A worker’s role comes from its agent. Reload this page and choose the agent for the role you need.',
  ),
  // #760: WORKER_NAME_REQUIRED replaced WORKER_REGISTER_EXHAUSTED when
  // hadron-server#1050 removed the cast-list register. The old code can no
  // longer fire — there is no register to exhaust — and the new one had no
  // mapping, so the single refusal a user could actually hit fell through to
  // the raw server string.
  //
  // The form now requires a name, so this should be unreachable from the
  // portal. It is mapped anyway: a refusal that arrives despite client-side
  // validation means the two have drifted, and a legible sentence beats a raw
  // code for whoever is reading the screen when that happens.
  WORKER_NAME_REQUIRED: () => t(
    'app.staff.error.name-required',
    'A worker needs a name. The platform no longer picks one — choose a name that is not already used in this App.',
  ),
  APP_UNINSTALLED: () => t(
    'app.staff.error.app-uninstalled',
    'This App has been uninstalled, so nothing can be cast into it.',
  ),
};

/**
 * createTeamChatMessage's typed refusals (#939/#941/#974) worth naming.
 *
 * The session-related codes are deliberately ABSENT: the portal posts without a
 * `sessionRef` (there is no worker session behind a browser), so
 * SESSION_NOT_IN_APP, SESSION_ENDED, SESSION_NOT_WORKER_BOUND and
 * WORKER_RETIRED are unreachable from here. Mapping them would be inventing
 * copy for states this surface cannot produce, and would go stale invisibly
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
const TEAM_CHAT_POST_ERRORS: Record<string, () => string> = {
  FORBIDDEN: () => t(
    'app.team-chat.error.forbidden',
    'You do not have access to post in this team chat. Posting needs App membership, or contributor access on the App’s organization.',
  ),
  TEAM_CHAT_BODY_TOO_LARGE: () => t(
    'app.team-chat.error.too-large',
    'That message is too long for the team chat (65536 characters max).',
  ),
  TEAM_CHAT_REPLY_NOT_FOUND: () => t(
    'app.team-chat.error.reply-not-found',
    'The message you are replying to no longer exists. Reload the team chat and try again.',
  ),
  // First-post bootstrap has to locate the Team Agent to create the chat root.
  // Both of these mean the App is not shaped like a team yet, which is a
  // configuration answer rather than a retry.
  TEAM_AGENT_NOT_FOUND: () => t(
    'app.team-chat.error.no-team-agent',
    'This App has no team agent, so its team chat cannot be started. Install an agent into the App first.',
  ),
  TEAM_AGENT_AMBIGUOUS: () => t(
    'app.team-chat.error.ambiguous-team-agent',
    'Several installed agents could own this App’s team chat, so it cannot be started automatically. Mark one as the team agent.',
  ),
  APP_UNINSTALLED: () => t(
    'app.team-chat.error.app-uninstalled',
    'This App has been uninstalled, so its team chat is read-only.',
  ),
};

/**
 * The `extensions.code` of a graphql-request ClientError, when it carries one.
 *
 * Returns null for a transport-level failure (no GraphQL errors payload) and
 * for any code that isn't a string, so callers fall through to the server's own
 * message rather than mislabelling an outage as a user mistake
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
function gqlErrorCode(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ extensions?: { code?: unknown } }> } })
    ?.response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const code = errors[0]?.extensions?.code;
  return typeof code === 'string' ? code : null;
}

function slugOfUrn(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

// Same cap and same reasoning as TEAM_CHAT_PAGE_SIZE: ask for the server's
// maximum, and report the server's `total` so a truncated view can say so
// rather than reading as the whole worklog.
const WORKLOG_PAGE_SIZE = 200;
// #744/#793 — how much of an arbitrary chat's transcript is fetched. The size
// now comes from `$lib/server/team-chat` (CHAT_PAGE_SIZE) rather than a second
// constant of the same name declared here: two "chat page size" values, 500 and
// 100, that nothing kept in step is the drift this module's own TEAM_CHAT_LOC
// comment warns about.

const APP_CONCEALED_REFUSALS: readonly string[] = ['FORBIDDEN', 'NOT_FOUND', 'APP_NOT_FOUND', 'UNAUTHENTICATED', 'BAD_USER_INPUT'];

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // #785: this load no longer carries the team chat's refresh. The poll reads
  // `team-chat/+server.ts` directly, because a background tick must not be able
  // to re-run THIS function — its failure paths are fatal (a 404 on an org
  // blip, 500s on transport) and would replace a working page with an error
  // page on a timer.
  // Worklog filters ride the URL rather than component state, because `ref`
  // lookup — "which worker sessions produced this PR?" — is the question the
  // worklog exists to answer, and an answer you cannot link to is half an
  // answer. They are applied SERVER-side: `teamWorkItems` normalizes a ref
  // tool-awarely, so a pasted PR URL and the short form find the same records.
  // A client-side compare over the loaded page would match neither reliably,
  // and would silently search only the fetched window.
  const worklogRef = normalizeFilter(url.searchParams.get('worklogRef'));
  const worklogKind = normalizeKind(url.searchParams.get('worklogKind'));
  const worklogTool = normalizeFilter(url.searchParams.get('worklogTool'));

  // `?tab=` so a filtered worklog URL lands on the worklog rather than the
  // page's default tab, and `?chat=` to preselect a conversation. Both rules
  // live in `tab-intent.ts` — pure, and therefore testable without mocking this
  // loader's ten queries (@copilot on #846).
  const { initialTab, requestedChat } = resolveTabIntent(url.searchParams);
  // `?view=full` opens the team chat maximised. Parsed here with the other
  // URL state so the page reads it once at init, like `initialTab`; toggling
  // it afterwards is `replaceState`, not a navigation.
  const initialChatFullView = chatFullViewFromParams(url.searchParams);
  // #1137: the team chat's team filter, `?team=<headRef>` or `?team=untagged`.
  // Read here with the other URL state and applied by the SERVER on the tail
  // read below. A malformed value is NOT the unfiltered thread: the chat reads
  // nothing and says the filter is invalid (`teamFilterInvalid`).
  const teamParam = parseTeamParam(url.searchParams.get('team'));
  const teamFilter = teamParam.ok ? teamParam.filter : NO_TEAM_FILTER;
  // The server's typed refusal of the head, when it gave one. Set from the tail
  // read's catch so the chat can show the server's own text instead of the
  // generic load error.
  let teamChatRefusal: { code: string; message: string } | null = null;
  // #648: canonical org-optional App detail. No requireNonConsumer — this
  // resolves BOTH org-owned apps (member-gated) and user-owned (org-less) apps
  // (owner-gated) through one owner-accessible path, exactly like /app/agents/[id]
  // (#641). The server's app(ref:) gate IS the auth; a non-owner/non-member gets
  // null → 404 (no over-exposure).
  const client = gqlClient(locals.token);
  const [appData, configsData, membersData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { ref: params.appId })
      .catch((e) => {
        // graphql-request throws on ANY GraphQL error even when usable data is
        // present. A non-critical NULLABLE field erroring (e.g. installedAgentUrn,
        // whose composeInstalledAgentUrn throws on a malformed app/agent urn)
        // must not 404 the whole page — salvage the app from the partial
        // response so it stays viewable/editable. Only a clean absence or the existing explicit
        // absence/refusal codes fall through to the 404 below. A null App
        // accompanied by a generic/unknown fault remains a 500. Only a GraphQL error
        // carries `response`; rethrow transport/network errors so they surface
        // as a 500, not a misleading 404.
        if (e && typeof e === 'object' && 'response' in e) {
          const partial = (e as { response?: { data?: { app?: App | null } } }).response?.data;
          if (partial?.app) return { app: partial.app };
          const code = extractGqlErrorCode(e);
          if (!APP_CONCEALED_REFUSALS.includes(code ?? '')) throw error(500, gqlErrorBody(e, t('app.load-failed', 'Could not load App.')));
          return { app: null };
        }
        throw e;
      }),
    // 036: APP-owned named configs. org-ADMIN gated server-side; a non-admin
    // member's call errors (the page hides the manager for them anyway).
    // Coerce to null so a transient failure surfaces as a load error to admins
    // instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'APP', ownerId: params.appId,
    }).catch(() => null),
    // #1005: the Human Team tab. null = the fetch failed, distinct from an App
    // with no members, so the tab can say so instead of showing "No members yet."
    // Bounded: a request that HANGS would otherwise hold every tab of the page.
    withTimeout(
      client
        .request<{ app: { members: AppMember[] | null } | null }>(APP_MEMBERS_QUERY, { ref: params.appId })
        // portal#1148: `members: null` is WITHHELD (hadron-server#2089), distinct from a
        // failed fetch (null here) and from a real [] (a known-empty roster).
        .then((r) => (r.app === null ? null : r.app.members === null ? ('withheld' as const) : r.app.members)),
      OPTIONAL_LIST_TIMEOUT_MS,
      null,
    ).catch((e) => {
      console.warn(`[app-members] members fetch failed for ${params.appId}:`, e);
      return null;
    }),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  const app = appData.app;

  // Org chrome only for an org-owned app; a user-owned (org-less) app (spec 047)
  // has none. availableAgents (what the Agents tab can install) = the org's
  // agents for an org app, or the caller's own personal agents ∪ PUBLIC agents
  // for an org-less app — mirroring the server install gate (createApp: a
  // personal App may install a PUBLIC or the caller's OWN personal agent). It is
  // sent whether or not the App already has an agent: an App holds MANY (#802),
  // and the picker must not vanish once the first is in (#1006).

  let org: AppOrg | null = null;
  let availableAgents: InstallableAgent[] = [];
  let availableAgentsError = false;
  let subscribedAgentsError = false;
  if (app.organizationId) {
    // #851: `loadOrgDetail` rather than a bare `.catch(() => ({ organization:
    // null }))`. That catch took no argument, so nothing was classified: a
    // connection failure, a bad gateway, a resolver crash and a genuine refusal
    // all fell into the 404 below and told the reader their App's organization
    // does not exist. During an outage that was EVERY org-owned App page. The
    // 404 itself stays — for an org-owned app a missing org is a real error and
    // not the org-less (spec 047) case, which is what the comment above is
    // about — but now only a code that means it answers it.
    //
    // #851 also narrows the DOCUMENT. `ORGANIZATION_QUERY` selected memories,
    // subscriptions, exchangeConnections and the full AgentFields to draw a
    // breadcrumb and one permission check; all are non-null lists, so any one of
    // them refusing nulled the org and 404'd this page over data it never shows.
    // `members` stays (AiServiceConfigSection's canManage). `agents` is NOT in
    // this document: the install picker draws it, and it is asked for below as
    // a request of its own.
    org = await loadOrgDetail<AppOrg>(
      locals.token,
      app.organizationId,
      APP_DETAIL_ORG_QUERY,
    );
    // #1006: the Agents tab's install picker, asked for on its own so a refusal
    // cannot null the org (see APP_ORG_AGENTS_QUERY).
    // #1172: the subscribed agents are a request of their own, so a failure of
    // that resolver costs only them and never the owned picker (portal#1188).
    const [owned, grants] = await Promise.all([
      withTimeout(
        client
          .request<{ organization: { agents: InstallableAgent[] } | null }>(APP_ORG_AGENTS_QUERY, {
            ref: app.organizationId,
          })
          .then((r) => r.organization?.agents ?? null),
        OPTIONAL_LIST_TIMEOUT_MS,
        null,
      ).catch((e) => {
        console.warn(`[app-agents] installable agents fetch failed for ${params.appId}:`, e);
        return null;
      }),
      withTimeout(
        client
          .request<{ organization: Pick<OrgAgentPool, 'agentOrgGrants'> | null }>(APP_ORG_AGENT_GRANTS_QUERY, {
            ref: app.organizationId,
          })
          .then((r) => r.organization?.agentOrgGrants ?? null),
        OPTIONAL_LIST_TIMEOUT_MS,
        null,
      ).catch((e) => {
        console.warn(`[app-agents] subscribed agents fetch failed for ${params.appId}:`, e);
        return null;
      }),
    ]);
    availableAgents = owned ? mergeInstallableAgents({ agents: owned, agentOrgGrants: grants ?? [] }) : [];
    availableAgentsError = owned === null;
    subscribedAgentsError = owned !== null && grants === null;
  } else {
    const [mine, publicAgents] = await Promise.all([
      // #782: MY_AGENTS_QUERY is scoped server-side (filter.ownedByMe), so it's
      // already the caller's own org-less agents — no client-side filter needed.
      withTimeout(
        fetchAllItems<InstallableAgent>(client, MY_AGENTS_QUERY, 'agents'),
        OPTIONAL_LIST_TIMEOUT_MS,
        null,
      ).catch(() => null),
      withTimeout(
        fetchAllItems<InstallableAgent>(client, PUBLIC_AGENTS_QUERY, 'publicAgents'),
        OPTIONAL_LIST_TIMEOUT_MS,
        null,
      ).catch(() => null),
    ]);
    availableAgentsError = mine === null || publicAgents === null;
    // Dedupe by id — a public agent could also be the caller's own.
    const seen = new Set<string>();
    availableAgents = [...(mine ?? []), ...(publicAgents ?? [])].filter((a) =>
      seen.has(a.id) ? false : (seen.add(a.id), true),
    );
  }

  // Memory tab nodes — only relevant when the App has memory access via its agents,
  // but the query is cheap and lets the Memory tab render uniformly.
  // 036: in parallel, the configs RESOLVABLE for the App's chat context
  // (App→Agent→Org→Host, masked) — powers the chat tab's config picker +
  // LLM-readiness gate. App-membership gated; coerce errors to null (unknown
  // ⇒ the page treats readiness as "don't block"). Only meaningful with an
  // agent linked.
  const userId = locals.user?.id ?? null;
  const [nodesData, chatConfigs, staff, teamChat, worklog, chatRoots, canManageApp, keyScopes, appKeys, viewerManages, teamRoster, bootPointers, liveStops] = await Promise.all([
    client
      .request<{ appNodes: MemoryNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: APP_NODES_LIMIT })
      .catch(() => ({ appNodes: [] as MemoryNode[] })),
    app.agentId
      ? client
          .request<{ resolveAiServiceConfigs: AiServiceConfig[] }>(RESOLVE_AI_SERVICE_CONFIGS_QUERY, {
            appRef: params.appId,
            agentRef: app.agentId,
          })
          .then((r) => r.resolveAiServiceConfigs)
          .catch(() => null)
      : Promise.resolve(null),
    // #974: the App's STAFF — its Workers. includeRetired because a retired
    // worker still holds its name forever, so hiding it turns the eventual
    // WORKER_NAME_TAKEN into a mystery. Coerced to null (never []) on failure:
    // "couldn't load the staff" and "this App has no staff yet" are different
    // statements and the empty state must not tell the second lie
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    fetchAllItems<Worker>(client, WORKERS_QUERY, 'workers', {
      appRef: params.appId,
      includeRetired: true,
    }).catch((e) => {
      console.warn(`[app-staff] workers fetch failed for ${params.appId}:`, e);
      return null;
    }),
    // #732: the App's TEAM CHAT transcript, read through the canonical
    // `teamChatMessages` operation. Deliberately NOT via appNodes — the chat
    // lives in the App's class='app' shared memory, which that resolver cannot
    // reach (hadron-server#1031); going through the operation keeps this
    // surface off that dependency and returns the author envelope besides.
    //
    // Reads never provision: an App whose chat has not been bootstrapped
    // answers with an empty page rather than erroring, so "no messages yet" is
    // a real state and not a failure.
    //
    // Coerced to null (never an empty page) on failure, for the same reason as
    // the staff fetch above: "couldn't load the team chat" and "the team chat
    // is empty" are different statements (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    // #1137: an invalid `?team=` reads nothing at all — never the unfiltered
    // thread under a filter the reader believes is on.
    (teamParam.ok ? loadTeamChatTail(client, params.appId, teamFilter) : Promise.resolve(null)).catch((e) => {
      teamChatRefusal = teamFilter.kind === 'team' ? teamChatRefusalOf(e) : null;
      console.warn(`[team-chat] transcript fetch failed for ${params.appId}:`, e);
      return null;
    }),
    // #733: the App's WORKLOG — the authoritative artifact-to-session join
    // (hrn:node:hadronmemory.com:specs:cor:agt:020:05). Same routing discipline as the team chat above: the
    // canonical operation, never appNodes.
    client
      .request<{ teamWorkItems: { items: TeamWorkItem[]; total: number } }>(TEAM_WORK_ITEMS_QUERY, {
        appRef: params.appId,
        ref: worklogRef,
        kind: worklogKind,
        tool: worklogTool,
        limit: WORKLOG_PAGE_SIZE,
      })
      .then((r) => r.teamWorkItems)
      .catch((e) => {
        console.warn(`[worklog] fetch failed for ${params.appId}:`, e);
        return null;
      }),
    // #744: the App's CHAT ROOTS, for the Chats selector. Server-side
    // nodeType filter, so this does not page an App's whole node set to find
    // two chats. Coerced to null (never []) on failure, for the same reason as
    // the staff and team-chat fetches: "couldn't load the chat list" and "this
    // App has one chat" are different statements.
    client
      .request<{ appNodes: MemoryNode[] }>(APP_CHAT_ROOTS_QUERY, {
        appRef: params.appId,
        limit: APP_CHAT_ROOTS_LIMIT,
      })
      .then((r) => r.appNodes)
      .catch((e) => {
        console.warn(`[app-chats] chat-root fetch failed for ${params.appId}:`, e);
        return null;
      }),
    // portal#1106: may the viewer change the App (the Client tab's plugin
    // grid)? A self-audit: effectiveAccess's App arm grants manage to exactly
    // the principals updateApp's gate admits (the owner of a user-owned App;
    // org admins/owners and platform admins on an org-owned one). null means
    // UNKNOWN, never "no": the page then keeps the controls and the server,
    // which is the gate either way, answers the write.
    userId && app.urn
      ? client
          .request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource: app.urn })
          .then((r) => r.effectiveAccess.canManage)
          .catch((e) => {
            console.warn(`[app-manage] manage check failed for ${params.appId}:`, e);
            return null;
          })
      : Promise.resolve(null),
    // portal#1099 — the App Keys tab's Scopes column, in its OWN request and
    // classified (never throws): `AppKey.scopes` is manager-only and non-null,
    // so selecting it on the keys themselves would null the whole list for
    // everyone else.
    loadAppKeyScopes(client, app.id),
    // portal#1068 — the key inventory, in its OWN classified request: App.keys is
    // manager-only and non-null (hadron-server#2080), so on the App fragment it
    // nulled the whole App (a false 404 here) for every non-manager.
    loadAppKeys(client, app.id),
    // portal#1153 — App.viewerManages in its own request (a server without the
    // field answers with an error, which must not take the page): the key
    // controls hide on a real `false` only.
    loadViewerManages(client, app.id),
    // portal#1168 (hadron-server#2178): the grid's Task and Paused state, one
    // bulk read in its own classified request so its failure cannot take the page.
    loadAppTeamRoster(client, app.id),
    // portal#1142 S8: the installs' boot-prompt pointers, for the Agents tab.
    readAppPointers(client, app.id),
    // portal#1139: the stops in effect, for the banner, in its OWN classified request
    // (never throws): a stop read that fails must not take the App page with it.
    loadLiveStops(client, app.id),
  ]);
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm, releaseWorkerForm, addMemberForm, ensureMemberForm, removeMemberForm] = await Promise.all([
    superValidate<AppSettingsForm>(
      {
        name: appData.app.name,
        urn: slugOfUrn(appData.app.urn),
        appType: appData.app.appType,
        role: appData.app.role,
        description: appData.app.description ?? '',

        createUserPermission: appData.app.createUserPermission,
        identifyUserMethod: appData.app.identifyUserMethod,
        sessionTimeoutSeconds: String(appData.app.sessionTimeoutSeconds),
        anonymousTtlDays: String(appData.app.anonymousTtlDays),
      },
      appSettingsFormAdapter,
      { errors: false },
    ),
    superValidate<AddAgentForm>(
      { agentId: '' },
      addAgentFormAdapter,
      { errors: false },
    ),
    superValidate<CreateAppKeyForm>(
      { label: '' },
      createAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<RemoveAppAgentForm>(
      { agentId: '' },
      removeAppAgentFormAdapter,
      { errors: false },
    ),
    superValidate<UpdateAppAgentToolsForm>(
      { agentTools: appData.app.agentTools ?? [] },
      updateAppAgentToolsFormAdapter,
      { errors: false },
    ),
    superValidate<RevokeAppKeyForm>(
      { keyId: '' },
      revokeAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<DeleteAppForm>(
      {},
      deleteAppFormAdapter,
      { errors: false },
    ),
    superValidate<CastWorkerForm>(
      { agentId: '' },
      castWorkerFormAdapter,
      { errors: false },
    ),
    superValidate<RetireWorkerForm>(
      { workerId: '' },
      retireWorkerFormAdapter,
      { errors: false },
    ),
    superValidate<ReleaseWorkerForm, ReleaseWorkerMessage>(
      // Both fields are filled from the ROW at click time (#825); seeded empty
      // with `errors: false` so the page does not render a validation error for
      // a form nobody has aimed at a worker yet.
      { workerId: '', expectedHolderUserId: '' },
      releaseWorkerFormAdapter,
      { errors: false },
    ),
    // #1005: userId is empty until the operator picks someone via the search
    // modal; the role starts at the first role the App offers (App.availableMemberRoles).
    superValidate(
      { userId: '', role: appData.app.availableMemberRoles?.[0] ?? '' },
      addAppMemberFormAdapter,
      { errors: false, id: 'addAppMember' },
    ),
    superValidate(
      { userId: '', role: appData.app.availableMemberRoles?.[0] ?? '' },
      ensureAppMemberFormAdapter,
      { errors: false, id: 'ensureAppMember' },
    ),
    superValidate({ userId: '' }, removeAppMemberFormAdapter, { errors: false }),
  ]);
  const postTeamChatMessageForm = await superValidate<PostTeamChatMessageForm>(
    {},
    postTeamChatMessageFormAdapter,
    { errors: false, id: `team:${params.appId}` },
  );

  // #744 — the App's chats as one browsable set.
  //
  // The agent chat is offered only when the App actually has one, matching the
  // condition the retired `chat` tab used, so an App with no linked agent does
  // not gain an entry that cannot render.
  const registeredChannels = await fetchAllItems<import('$lib/types').Channel>(client, APP_CHANNELS_QUERY, 'channels', { appRef: params.appId })
    .catch(() => null);
  const appChats = withRegisteredChannels(
    buildAppChatList(chatRoots ?? [], { hasAgentChat: !!app.agentId }), registeredChannels ?? [],
    (app as typeof app & { defaultChannel?: { id: string } | null }).defaultChannel?.id,
  );
  const { selected: selectedChat, requestedMissing: chatNotFound } = resolveSelectedChat(
    appChats,
    requestedChat,
  );

  // Registered Channels use the addressed operation and the same envelope as
  // the default team chat. Unregistered old roots retain their node transcript;
  // this read never creates a Channel or routes a post to the default thread.
  const selectedChannelMessages = selectedChat?.channelId
    ? await readChannelPage(client, params.appId, selectedChat.channelId, {}).catch(() => null) : null;
  const postChannelMessageForm = selectedChat?.channelId
    ? await superValidate({ channelRef: selectedChat.channelId }, postTeamChatMessageFormAdapter,
      { errors: false, id: `channel:${selectedChat.channelId}` }) : null;
  const selectedChatMessages =
    selectedChat?.kind === 'other' && selectedChat.memoryId
      ? await loadChatMessages(client, selectedChat.memoryId, selectedChat.key)
          .catch((e) => {
            console.warn(`[app-chats] messages fetch failed for ${selectedChat.key}:`, e);
            return null;
          })
      : null;

  const [appMemories, createMemoryForm] = await Promise.all([
    readAppMemories(client, app.organizationId, app.id),
    superValidate(zod4(createAppMemorySchema), { id: `createAppMemory:${app.id}`, errors: false }),
  ]);

  return {
    appMemories,
    createMemoryForm,
    canCreateMemory: canCreateAppMemory(org, locals.user?.id ?? null, { userOwned: !app.organizationId, canManageApp: canManageApp as boolean | null }),
    app,
    org,
    availableAgents,
    availableAgentsError,
    subscribedAgentsError,
    appNodes: nodesData.appNodes,
    appNodesCapped: isCapped(nodesData.appNodes?.length ?? 0, APP_NODES_LIMIT),
    chatConfigs,
    appConfigs: configsData ?? [],
    configsError: configsData === null,
    // #974: the App's staff. null = the fetch failed (distinct from []).
    staff,
    teamRoster,
    // portal#1492: one clock for the terminal ages, so server render and hydration agree.
    terminalNow: new Date().toISOString(),
    staffError: staff === null,
    // #732: the team chat transcript. null = the fetch failed (distinct from
    // an empty chat), and `teamChatTotal` is the SERVER's count, so a
    // transcript truncated at the page cap can say so instead of looking whole.
    teamChatMessages: teamChat?.items ?? [],
    teamChatTotal: teamChat?.total ?? 0,
    teamChatError: teamChat === null,
    // #1137: what the transcript was read UNDER, so the thread and its poll
    // carry the same filter, plus why a filtered read produced nothing.
    teamFilter,
    teamFilterInvalid: !teamParam.ok,
    teamChatRefusal,
    // #733: the worklog page, plus the filters that produced it so the tab can
    // render its own controls from the URL rather than keeping a second copy of
    // that state in the component.
    worklog: worklog?.items ?? [],
    worklogTotal: worklog?.total ?? 0,
    worklogError: worklog === null,
    // #744: the App's chats, the one selected, and its transcript when that
    // chat is neither the team chat nor the agent chat. `chatsError` is the
    // discovery failing — distinct from an App that genuinely has one chat.
    appChats,
    chatsError: chatRoots === null || registeredChannels === null,
    chatRootsShown: chatRoots?.length ?? 0,
    chatsCapped: chatRoots !== null && isCapped(chatRoots?.length ?? 0, APP_CHAT_ROOTS_LIMIT),
    selectedChannelId: selectedChat?.channelId ?? null,
    selectedChannelMessages: selectedChannelMessages?.items ?? [],
    selectedChannelTotal: selectedChannelMessages?.total ?? 0,
    selectedChannelError: !!selectedChat?.channelId && selectedChannelMessages === null,
    postChannelMessageForm,
    selectedChatKey: selectedChat?.key ?? null,
    selectedChatMessages: selectedChatMessages?.messages ?? [],
    // #793 (@copilot on PR #797): gate on the KIND. `selectedChatMessages` is
    // null both when the fetch failed and when there was no fetch to make (a
    // team or agent chat), and I collapsed those when I normalised the ternary's
    // else-branch from `[]` to `null`. "No transcript" is not "the transcript
    // failed", and a flag that says the second when it means the first is one
    // careless consumer away from an error banner on a working page.
    selectedChatError: selectedChat?.kind === 'other' && selectedChatMessages === null,
    // #744: hitting the cap is DISCLOSED rather than presented as a whole
    // transcript (Codex P2 on #759). #793 replaced the guess with the fact:
    // `loadChatMessages` now returns the server's `total` and a `hasOlder`
    // flag, so this no longer infers "there is more" from a full page. Reading
    // fewer-than-asked as final is how a paginated view stops early, and the
    // old heuristic did exactly that in reverse.
    selectedChatTruncated: selectedChatMessages?.hasOlder ?? false,
    chatNotFound,
    initialTab,
    initialChatFullView,
    worklogFilters: {
      ref: worklogRef ?? '',
      // The NORMALIZED kind, not the raw param: echoing back a rejected value
      // would render a filter chip for a filter the server never applied.
      kind: worklogKind ?? '',
      tool: worklogTool ?? '',
    },
    currentUserId: locals.user?.id ?? null,
    canManageApp: canManageApp as boolean | null,
    bootPointers,
    liveStops,
    // The App half of a pointer result's key (the action's own params.appId).
    bootPointerAppKey: params.appId,
    keyScopes,
    appKeys,
    viewerManages,
    appSettingsForm,
    addAgentForm,
    createKeyForm,
    removeAgentForm,
    updateAgentToolsForm,
    revokeKeyForm,
    deleteAppForm,
    castWorkerForm,
    retireWorkerForm,
    releaseWorkerForm,
    postTeamChatMessageForm,
    // #1005: the Human Team tab. null members = the fetch failed.
    members: Array.isArray(membersData) ? membersData : [],
    membersError: membersData === null,
    membersWithheld: membersData === 'withheld',
    addMemberForm,
    ensureMemberForm,
    removeMemberForm,
  };
};

export const actions: Actions = {
  createMemory,
  createCustomisation: async ({ request, params, locals }) =>
    writeCustomisation(gqlClient(locals.token), params.appId, await request.formData(), true),
  saveCustomisation: async ({ request, params, locals }) =>
    writeCustomisation(gqlClient(locals.token), params.appId, await request.formData(), false),
  // #1005: the Human Team tab's actions (see member-actions.ts).
  addMember,
  ensureMember,
  removeMember,

  // portal#1142 S8 (hadron-server#2219): set or clear one install's pointer.
  // The App's manager, as themselves; the server decides. Keyed by agent id so
  // the result shows on that row only.
  setAppAgentBootPrompt: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentRef = String(fd.get('agentRef') ?? '');
    return pointerAction(fd, 'app', appAgentPointerKey(params.appId, agentRef), (nodeRef) =>
      gqlClient(locals.token).request(SET_APP_AGENT_BOOT_PROMPT_MUTATION, { appRef: params.appId, agentRef, nodeRef }));
  },

  update: async ({ request, params, locals }) => {
    const form = await superValidate<AppSettingsForm>(
      await request.formData(),
      appSettingsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        ref: params.appId,
        name: form.data.name,
        urn: form.data.urn,
        appType: form.data.appType,
        role: form.data.role,
        description: form.data.description || null,

        createUserPermission: form.data.createUserPermission,
        identifyUserMethod: form.data.identifyUserMethod,
        sessionTimeoutSeconds: Number(form.data.sessionTimeoutSeconds),
        anonymousTtlDays: Number(form.data.anonymousTtlDays),
      });
      return message(form, { type: 'success', text: t('app.settings.saved', 'Saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update app') },
        { status: 500 },
      );
    }
  },

  addAgent: async ({ request, params, locals }) => {
    const form = await superValidate<AddAgentForm>(
      await request.formData(),
      addAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    // #802: installs the agent as a row on the AppAgent join — an App holds
    // MANY agents. The previous comment here said `addAgentToApp` "is now a
    // setter on App.agent_id", which 023-app-shape Phase 2b made false when it
    // moved the relationship off that column; it is worse than no comment on a
    // multi-agent model, because it points the next reader at a column that is
    // no longer the source of truth.
    //
    // The legacy `role` arg is gone (system memory is universally read-only
    // from any App context). `trainingMode` is forwarded only when the form
    // submits it explicitly, so the server default applies otherwise — see
    // `hrn:node:hadronmemory.com:hadron-cli:review:an-empty-flag-is-not-an-absent-flag`
    // for why "submitted but empty" and "not submitted" must stay
    // distinguishable.
    const variables: Record<string, unknown> = { appRef: params.appId, agentRef: form.data.agentId };
    if (typeof form.data.trainingMode === 'string') variables.trainingMode = form.data.trainingMode === 'true';
    try {
      await gqlClient(locals.token).request(INSTALL_AGENT_INTO_APP_MUTATION, variables);
      return message(form, { type: 'success', text: t('app.agent.linked', 'Agent linked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to add agent') },
        { status: 500 },
      );
    }
  },

  removeAgent: async ({ request, params, locals }) => {
    const form = await superValidate<RemoveAppAgentForm>(
      await request.formData(),
      removeAppAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UNINSTALL_AGENT_FROM_APP_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
      });
      return message(form, { type: 'success', text: t('app.agent.unlinked', 'Agent unlinked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to remove agent') },
        { status: 500 },
      );
    }
  },

  updateAgentTools: async ({ request, params, locals }) => {
    const form = await superValidate<UpdateAppAgentToolsForm>(
      await request.formData(),
      updateAppAgentToolsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        ref: params.appId,
        agentTools: form.data.agentTools,
      });
      return message(form, { type: 'success', text: t('app.agent-tools.saved', 'Client tools saved.') });
    } catch (e: unknown) {
      // portal#1106: a manager refusal names the rule, as a 403.
      const { status, text } = agentToolsRefusal(e, 'Failed to update agent tools');
      return message(form, { type: 'error', text }, { status });
    }
  },

  // ── Casting (#974) ──────────────────────────────────────────────────────
  //
  // castWorker CASTS an agent that is ALREADY INSTALLED in this App; it mints
  // nothing.
  //
  // #760: `name` is now REQUIRED — hadron-server#1050 removed the cast-list
  // register, so there is no "let the server choose" path left and the schema
  // rejects a blank one before we get here.
  //
  // R222: role comes from the selected Agent, never from a posted override.
  castWorker: async ({ request, params, locals }) => {
    const form = await superValidate<CastWorkerForm>(
      await request.formData(),
      castWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CAST_WORKER_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
        // #760: sent as-is. The schema guarantees a non-empty name, so the
        // `|| undefined` coercion that used to mean "server, you choose" now
        // has nothing to express — and leaving it would quietly turn a
        // validation gap into a nameless cast the server refuses.
        name: form.data.name,

      });
      return message(form, {
        type: 'success',
        text: t('app.staff.cast.success', 'Worker cast.'),
      });
    } catch (e: unknown) {
      // Known refusals get copy that says what to do next; anything else —
      // including a transport failure with no GraphQL payload — falls through
      // to the server's own message rather than being relabelled as a user
      // mistake (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
      // #835 — `lookupOwn`: the key is the server's `extensions.code`, so an
      // inherited one returns a callable that `known()` below would invoke,
      // putting `{}` into a user-facing error slot instead of the server's own
      // message. Same shape as the asset copy table fixed in #833.
      const known = lookupOwn(CAST_WORKER_ERRORS, gqlErrorCode(e));
      return message(
        form,
        {
          type: 'error',
          text: known ? known() : extractGqlError(e, t('app.staff.cast.error', 'Failed to cast the worker.')),
        },
        { status: 500 },
      );
    }
  },

  // Post to the App's TEAM CHAT (#732).
  //
  // Note what this action does NOT accept: no chat address. The server owns the
  // App's one well-known team chat and resolves it from `appRef`, which is why
  // a portal post cannot land in the wrong thread the way a loc-addressed write
  // could.
  //
  // No `sessionRef` either: a browser has no worker session, so the post is
  // attributed to the signed-in HUMAN. That is correct and deliberate — a
  // portal user posting as a worker would be forged attribution on the record
  // the team uses to answer "who did this".
  postTeamChatMessage: async ({ request, params, locals }) => {
    const form = await superValidate<PostTeamChatMessageForm>(
      await request.formData(),
      postTeamChatMessageFormAdapter,
      { id: `team:${params.appId}` },
    );
    if (!form.valid) return fail(400, { form });

    // An unparseable or non-positive replyToSeq is dropped rather than sent:
    // seq ascends from 1, so 0 or NaN could only ever be a client bug, and
    // sending it would turn a stray hidden input into TEAM_CHAT_REPLY_NOT_FOUND
    // on an ordinary post.
    const parsedReplyTo = Number(form.data.replyToSeq);
    const replyToSeq =
      form.data.replyToSeq && Number.isInteger(parsedReplyTo) && parsedReplyTo > 0
        ? parsedReplyTo
        : undefined;

    try {
      await gqlClient(locals.token).request(CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
        appRef: params.appId,
        body: form.data.body,
        replyToSeq,
      });
      return message(form, {
        type: 'success',
        text: t('app.team-chat.post.success', 'Posted to the team chat.'),
      });
    } catch (e: unknown) {
      // #835 — as above: wire-supplied key, so guard the lookup.
      const known = lookupOwn(TEAM_CHAT_POST_ERRORS, gqlErrorCode(e));
      return message(
        form,
        {
          type: 'error',
          text: known
            ? known()
            : extractGqlError(e, t('app.team-chat.post.error', 'Failed to post to the team chat.')),
        },
        { status: 500 },
      );
    }
  },

  postChannelMessage: async ({ request, params, locals }) => {
    const input = await request.formData();
    const channelRef = String(input.get('channelRef') ?? '');
    const form = await superValidate(input, postTeamChatMessageFormAdapter, { id: `channel:${channelRef}` });
    if (!form.valid) return fail(400, { form });
    if (!form.data.channelRef) return message(form, { type: 'error', text: t('app.channel.choose', 'Choose a chat before posting.') }, { status: 400 });
    const reply = Number(form.data.replyToSeq);
    try {
      await postToChannel(gqlClient(locals.token), params.appId, form.data.channelRef, form.data.body,
        Number.isSafeInteger(reply) && reply > 0 ? reply : undefined);
      return message(form, { type: 'success', text: t('app.channel.post.success', 'Posted to the chat.') });
    } catch {
      return message(form, { type: 'error', text: t('app.channel.post.failed', 'Could not post to this chat. Your message has been kept; check your access and try again.') }, { status: 500 });
    }
  },

  // portal#1168 — Pause / Unpause a worker. PAUSE INTENT ONLY: an explicit
  // user-selected end time, or clearPause. The portal invents no duration, never
  // resends `mentions` or any other wake setting, and lets the server's gate
  // (the worker, its holder or an App manager) decide. A refusal is a fixed
  // message, never the provider payload, and never success; the page re-reads
  // the authoritative roster after a success instead of flipping a badge.
  setWorkerPause: async ({ request, locals }) => {
    const fd = await request.formData();
    const workerId = String(fd.get('workerId') ?? '').trim();
    const mode = String(fd.get('mode') ?? '');
    const until = String(fd.get('until') ?? '').trim();
    const bad = (text: string) => fail(400, { pauseResult: { ok: false as const, workerId, message: text } });
    if (!workerId) return bad(t('app.staff.pause.error.worker', 'Choose a worker.'));
    let input: { pausedUntil: string } | { clearPause: true };
    if (mode === 'clear') {
      input = { clearPause: true };
    } else if (mode === 'pause') {
      const ms = Date.parse(until);
      if (!until || Number.isNaN(ms)) return bad(t('app.staff.pause.error.until', 'Choose when the pause ends.'));
      if (ms <= Date.now()) return bad(t('app.staff.pause.error.past', 'The pause must end in the future.'));
      input = { pausedUntil: new Date(ms).toISOString() };
    } else {
      return bad(t('app.staff.pause.error.mode', 'Choose Pause or Unpause.'));
    }
    try {
      await gqlClient(locals.token).request(SET_WORKER_WAKE_SETTINGS_MUTATION, { workerRef: workerId, input });
      return { pauseResult: { ok: true as const, workerId, message: mode === 'clear'
        ? t('app.staff.unpause.success', 'Pause cleared.')
        : t('app.staff.pause.success', 'Worker paused.') } };
    } catch (e: unknown) {
      // The server's real refusal for this write is WAKE_SETTINGS_FORBIDDEN
      // (Riana, Charles on #1237); FORBIDDEN is the generic gate code.
      const code = gqlErrorCode(e);
      const forbidden = code === 'FORBIDDEN' || code === 'WAKE_SETTINGS_FORBIDDEN';
      return fail(forbidden ? 403 : 500, { pauseResult: { ok: false as const, workerId, message: forbidden
        ? t('app.staff.pause.error.forbidden', 'You can’t pause or unpause this worker. Only the worker, its holder or an App manager can.')
        : t('app.staff.pause.error.failed', 'Could not confirm the change. Check the worker’s status and try again.') } });

    }
  },

  // #1023: no local eligibility or App-based authority shortcut. The mutation
  // resolves the supplied worker and checks its own staffing/reference gates.
  deleteWorker: async ({ request, locals }) => {
    const posted = await request.formData();
    const workerRef = typeof posted.get('workerRef') === 'string' ? String(posted.get('workerRef')) : '';
    const refuse = (status: number, message: string, code: string | null = null) =>
      fail(status, { deleteWorkerResult: { ok: false, workerRef, message, code } satisfies DeleteWorkerResult });
    if (['_kind', 'workerRef', 'confirmation'].some(key => posted.getAll(key).length !== 1)) {
      return refuse(400, t('app.staff.delete.confirm-required', 'Explicit external-artifact verification is required.'));
    }
    const parsed = deleteWorkerSchema.safeParse(Object.fromEntries(posted));
    if (!parsed.success) return refuse(400, t('app.staff.delete.confirm-required', 'Explicit external-artifact verification is required.'));
    try {
      const result = await gqlClient(locals.token).request<{ deleteWorker: boolean }>(DELETE_WORKER_MUTATION, {
        workerRef: parsed.data.workerRef, confirmNoExternalAttribution: true,
      });
      if (result.deleteWorker !== true) return refuse(500, t('app.staff.delete.unconfirmed', 'Deletion was not confirmed. Refresh the roster before trying again.'));
      return { deleteWorkerResult: { ok: true, workerRef: parsed.data.workerRef,
        message: t('app.staff.delete.done', 'Worker deleted.') } satisfies DeleteWorkerResult };
    } catch (e: unknown) {
      const code = gqlErrorCode(e);
      // Only GraphQL's own refusal sentence, never the request/extension census
      // or a transport exception containing query variables, reaches the UI.
      const errors = (e as { response?: { errors?: { message?: string }[] } } | null)?.response?.errors;
      const status = code === 'FORBIDDEN' ? 403
        : code === 'WORKER_NOT_FOUND' ? 404
        : code === 'WORKER_IN_USE' || code === 'WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED' ? 400 : 500;
      const text = status < 500 && typeof errors?.[0]?.message === 'string'
        ? errors[0].message
        : t('app.staff.delete.failed', 'Could not confirm deletion. Refresh the roster and try again.');
      return refuse(status, text, code);
    }
  },

  // Retiring ends the casting but reserves the name FOREVER — it is not a
  // delete, and the row stays visible in the staff list.
  retireWorker: async ({ request, locals }) => {
    const form = await superValidate<RetireWorkerForm>(
      await request.formData(),
      retireWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(RETIRE_WORKER_MUTATION, {
        workerRef: form.data.workerId,
      });
      return message(form, {
        type: 'success',
        text: t('app.staff.retire.success', 'Worker retired. Its name stays reserved.'),
      });
    } catch (e: unknown) {
      // Same staffing gate as castWorker, so the same legible refusal.
      const forbidden = gqlErrorCode(e) === 'FORBIDDEN';
      return message(
        form,
        {
          type: 'error',
          text: forbidden
            ? STAFFING_FORBIDDEN()
            : extractGqlError(e, t('app.staff.retire.error', 'Failed to retire the worker.')),
        },
        { status: 500 },
      );
    }
  },

  // #756 / hadron-server#1050 — release a HELD name so somebody else can hold
  // it. Deliberately a SEPARATE action from retireWorker rather than a mode of
  // it: retiring ends the casting and keeps the name reserved forever, while
  // releasing leaves the worker active and touches neither its name allocation
  // nor its history. The issue asked to rename Retire to Release; these are two
  // operations that differ on whether the name ever becomes available again, so
  // the portal grew the missing one instead of relabelling the wrong one.
  releaseWorker: async ({ request, locals }) => {
    const form = await superValidate<ReleaseWorkerForm, ReleaseWorkerMessage>(
      await request.formData(),
      releaseWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      const result = await gqlClient(locals.token).request<{
        releaseWorker: ReleaseWorkerPayload;
      }>(RELEASE_WORKER_MUTATION, {
        workerRef: form.data.workerId,
        expectedHolderUserId: form.data.expectedHolderUserId,
      });
      return message(form, releaseOutcomeMessage(result.releaseWorker));
    } catch (e: unknown) {
      // #825 — the guarded write refused because the hold is not what the
      // roster showed. Handled BEFORE the generic branches: it is not a server
      // fault and not a permission problem, and reporting it as either would
      // describe the wrong thing to fix.
      const stale = readHoldStale(e);
      if (stale) return message(form, staleHoldMessage(stale, locals.user?.id ?? null), { status: 409 });

      // Same staffing gate as castWorker/retireWorker, so the same legible
      // refusal rather than a raw GraphQL error.
      const forbidden = gqlErrorCode(e) === 'FORBIDDEN';
      return message(
        form,
        {
          type: 'error',
          text: forbidden
            ? RELEASE_FORBIDDEN()
            : extractGqlError(e, t('app.staff.release.error', 'Failed to release the name.')),
        },
        { status: 500 },
      );
    }
  },

  createKey: async ({ request, params, locals }) => {
    const form = await superValidate<CreateAppKeyForm>(
      await request.formData(),
      createAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const label = form.data.label || undefined;
    try {
      const result = await gqlClient(locals.token).request<{
        createAppKey: { key: { id: string }; rawKey: string };
      }>(CREATE_APP_KEY_MUTATION, { appRef: params.appId, label });
      return {
        form,
        rawKey: result.createAppKey.rawKey,
        keyId: result.createAppKey.key.id,
      };
    } catch (e: unknown) {
      // portal#1068: a manager refusal names the rule, as a 403.
      const { status, text } = appKeyRefusal(e, 'Failed to create key');
      return message(form, { type: 'error', text }, { status });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const form = await superValidate<RevokeAppKeyForm>(
      await request.formData(),
      revokeAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { id: form.data.keyId });
      return message(form, { type: 'success', text: t('app.key.revoked', 'Key revoked.') });
    } catch (e: unknown) {
      const { status, text } = appKeyRefusal(e, 'Failed to revoke key');
      return message(form, { type: 'error', text }, { status });
    }
  },

  deleteApp: async ({ request, params, locals }) => {
    const form = await superValidate<DeleteAppForm>(
      await request.formData(),
      deleteAppFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    // #648: where to land after delete depends on ownership — an org app returns
    // to its org apps grid, a user-owned (org-less) app to the personal "My apps"
    // list. Resolve the org BEFORE deleting (the row is gone afterwards); a
    // lookup failure falls back to the personal list.
    let orgId: string | null = null;
    try {
      const res = await client.request<{ app: { organizationId: string | null } | null }>(
        APP_ORG_QUERY,
        { ref: params.appId },
      );
      orgId = res.app?.organizationId ?? null;
    } catch {
      // Non-fatal — the redirect target degrades to the personal list.
    }

    try {
      await client.request(DELETE_APP_MUTATION, { ref: params.appId });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete app') },
        { status: 500 },
      );
    }
    redirect(303, orgId ? `/app/orgs/${orgId}/apps` : '/app/apps');
  },
};
